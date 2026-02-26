import type {
  Plugin,
  RequestContext,
  PluginRequestResult,
  ResponseInterceptContext,
  ResponseCompleteContext,
  PluginResponseResult,
} from '../types.js';
import { ToolCallsRepository } from '../../storage/repositories/tool-calls.js';
import { ToolGuardRulesRepository } from '../../storage/repositories/tool-guard-rules.js';
import { AuditLogRepository } from '../../storage/repositories/audit-log.js';
import { extractToolCalls, extractToolCallsFromParsedEvents, type ExtractedToolCall } from '../../tool-guard/extractor.js';
import { matchRules, BUILTIN_RULES, type ToolGuardRule, type RuleMatch } from '../../tool-guard/rules.js';
import { dispatchAlert, shouldAlert, type AlertConfig } from '../../tool-guard/alert.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('tool-guard');

export interface ToolGuardConfig {
  enabled: boolean;
  action: 'audit' | 'block';
  recordAll: boolean;
  blockMinSeverity: string;
  alertMinSeverity: string;
  alertDesktop: boolean;
  alertWebhookUrl: string;
  /** Live getter — when provided, overrides static fields for hot-reload */
  getLiveConfig?: () => { action: string; recordAll: boolean; blockMinSeverity: string; alertMinSeverity: string };
}

interface MatchedToolCall {
  tc: ExtractedToolCall;
  ruleMatch: RuleMatch | null;
}

function analyzeToolCalls(body: string, isStreaming: boolean, rules: ToolGuardRule[]): MatchedToolCall[] {
  const toolCalls = extractToolCalls(body, isStreaming);
  return toolCalls.map(tc => ({
    tc,
    ruleMatch: matchRules(tc.toolName, tc.toolInput, rules),
  }));
}

export function createToolGuardPlugin(db: Database.Database, config: ToolGuardConfig): Plugin {
  const repo = new ToolCallsRepository(db);
  const rulesRepo = new ToolGuardRulesRepository(db);
  const auditRepo = new AuditLogRepository(db);

  // Seed built-in rules on first init (INSERT OR IGNORE preserves user toggles)
  rulesRepo.seedBuiltins(BUILTIN_RULES);

  // Live config readers — support hot-reload from Dashboard
  const getAction = () => config.getLiveConfig ? config.getLiveConfig().action : config.action;
  const getRecordAll = () => config.getLiveConfig ? config.getLiveConfig().recordAll : config.recordAll;
  const getBlockMinSeverity = () => config.getLiveConfig ? config.getLiveConfig().blockMinSeverity : config.blockMinSeverity;
  const getAlertMinSeverity = () => config.getLiveConfig ? config.getLiveConfig().alertMinSeverity : config.alertMinSeverity;

  function getAlertConfig(): AlertConfig {
    return {
      minSeverity: getAlertMinSeverity() ?? 'high',
      desktop: config.alertDesktop ?? true,
      webhookUrl: config.alertWebhookUrl ?? '',
    };
  }

  /**
   * Determine the action result for a tool call:
   * - 'block' if action=block and severity meets blockMinSeverity
   * - 'flag' if rule matched but not blocked
   * - 'pass' if no rule matched
   */
  function resolveAction(ruleMatch: RuleMatch | null): string {
    if (!ruleMatch) return 'pass';
    if (getAction() === 'block' && shouldAlert(ruleMatch.rule.severity, getBlockMinSeverity())) {
      return 'block';
    }
    return 'flag';
  }

  /** Record tool calls to DB and dispatch alerts. Returns count of flagged calls. */
  function recordAndAlert(
    matches: MatchedToolCall[],
    requestId: string,
    sessionId?: string,
  ): number {
    const recordAll = getRecordAll() !== false;
    let flaggedCount = 0;
    for (const { tc, ruleMatch } of matches) {
      if (!ruleMatch && !recordAll) continue;

      const inputStr = typeof tc.toolInput === 'string'
        ? tc.toolInput
        : JSON.stringify(tc.toolInput);

      const actionResult = resolveAction(ruleMatch);

      repo.insert({
        id: crypto.randomUUID(),
        request_id: requestId,
        tool_name: tc.toolName,
        tool_input: inputStr,
        rule_id: ruleMatch?.rule.id ?? null,
        rule_name: ruleMatch?.rule.name ?? null,
        severity: ruleMatch?.rule.severity ?? 'info',
        category: ruleMatch?.rule.category ?? null,
        action: actionResult,
        provider: tc.provider,
        session_id: sessionId ?? null,
      });

      if (ruleMatch) {
        flaggedCount++;
        log.warn('Dangerous tool call detected', {
          requestId,
          toolName: tc.toolName,
          ruleId: ruleMatch.rule.id,
          severity: ruleMatch.rule.severity,
          matched: ruleMatch.matchedText,
          action: actionResult,
        });

        dispatchAlert(getAlertConfig(), tc.toolName, ruleMatch, requestId, sessionId);
      }
    }
    return flaggedCount;
  }

  return {
    name: 'tool-guard',
    priority: 15,

    // ── Load rules from DB and set streaming block flag ──
    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      const rules = rulesRepo.getEnabled();
      context._toolGuardRules = rules;
      log.debug('onRequest', { action: getAction(), recordAll: getRecordAll(), isStreaming: context.isStreaming });
      if (getAction() === 'block' && context.isStreaming) {
        context._toolGuardStreamBlock = getBlockMinSeverity();
      }
    },

    // ── Pre-send: block dangerous tool calls in non-streaming responses ──
    async onResponse(context: ResponseInterceptContext): Promise<PluginResponseResult | void> {
      const currentAction = getAction();
      log.debug('onResponse', { action: currentAction, isStreaming: context.isStreaming });
      if (currentAction !== 'block') return;
      if (context.isStreaming) return; // streaming handled in onResponseComplete (post-send audit only)

      const rules = context.request._toolGuardRules ?? rulesRepo.getEnabled();
      const matches = analyzeToolCalls(context.body, false, rules);
      log.debug('onResponse analysis', {
        requestId: context.request.id,
        toolCalls: matches.length,
        bodyLen: context.body.length,
      });
      if (matches.length === 0) return;

      // Check if any flagged call meets the block severity threshold
      const currentBlockMin = getBlockMinSeverity();
      const blockable = matches.filter(
        m => m.ruleMatch && shouldAlert(m.ruleMatch.rule.severity, currentBlockMin),
      );

      // Record all tool calls and dispatch alerts
      const flagged = recordAndAlert(matches, context.request.id, context.request.sessionId);
      if (flagged > 0) {
        context.request.toolGuardHit = true;
        context.request.toolGuardFindings = flagged;
      }

      // Mark that onResponse already recorded these (so onResponseComplete can skip)
      context.request._toolGuardRecorded = true;

      if (blockable.length > 0) {
        const reasons = blockable.map(m =>
          `${m.tc.toolName}: ${m.ruleMatch!.rule.name} (${m.ruleMatch!.rule.severity})`,
        );
        const reason = `Response blocked by Tool Guard: dangerous tool call detected — ${reasons.join('; ')}`;
        log.warn('Blocking response', { requestId: context.request.id, blocked: reasons });

        // Auto-audit on tool-guard block (same pattern as DLP scanner)
        try {
          auditRepo.insert({
            id: crypto.randomUUID(),
            request_id: context.request.id,
            requestBody: context.request.body,
            responseBody: context.body,
            toolGuardHit: true,
          });
        } catch (err) {
          log.warn('Failed to write tool-guard auto-audit', { error: (err as Error).message });
        }

        return { blocked: { reason } };
      }
    },

    // ── Post-send: audit all tool calls (streaming + non-streaming fallback) ──
    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      // Skip if onResponse already recorded (non-streaming + action=block)
      if (context.request._toolGuardRecorded) return;

      try {
        const rules = context.request._toolGuardRules ?? rulesRepo.getEnabled();

        // Use pre-parsed SSE events when available (avoids expensive body re-parsing)
        let matches: MatchedToolCall[];
        if (context.sseEvents && context.sseEvents.length > 0) {
          const toolCalls = extractToolCallsFromParsedEvents(context.sseEvents);
          matches = toolCalls.map(tc => ({
            tc,
            ruleMatch: matchRules(tc.toolName, tc.toolInput, rules),
          }));
        } else {
          matches = analyzeToolCalls(context.body, context.isStreaming, rules);
        }

        log.debug('onResponseComplete', {
          requestId: context.request.id,
          isStreaming: context.isStreaming,
          toolCalls: matches.length,
          bodyLen: context.body.length,
          usedPreParsed: Boolean(context.sseEvents?.length),
        });
        if (matches.length === 0) return;

        const flagged = recordAndAlert(matches, context.request.id, context.request.sessionId);
        if (flagged > 0) {
          context.request.toolGuardHit = true;
          context.request.toolGuardFindings = flagged;
        }

        log.debug('Tool calls recorded', {
          requestId: context.request.id,
          total: matches.length,
          flagged,
        });
      } catch (err) {
        log.warn('Tool guard processing failed', { error: (err as Error).message });
      }
    },
  };
}
