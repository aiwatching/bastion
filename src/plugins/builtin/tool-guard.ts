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

/**
 * Replace blocked tool_use blocks with text warnings in the response body.
 * Supports Anthropic (content[].type=tool_use) and OpenAI (choices[].message.tool_calls) formats.
 */
function replaceBlockedToolCalls(
  parsedBody: Record<string, unknown> | null,
  blockable: MatchedToolCall[],
): string {
  const blockedNames = new Set(blockable.map(m => m.tc.toolName));

  if (!parsedBody) {
    // Can't parse — return a simple warning
    const warnings = blockable.map(m =>
      `[BLOCKED by Bastion Tool Guard] Tool "${m.tc.toolName}" was blocked: ${m.ruleMatch!.rule.name} (${m.ruleMatch!.rule.severity})`,
    );
    return JSON.stringify({ type: 'error', error: { type: 'tool_guard_blocked', message: warnings.join('; ') } });
  }

  const body = JSON.parse(JSON.stringify(parsedBody)); // deep clone

  // Anthropic format: content[] array with type=tool_use blocks
  if (Array.isArray(body.content)) {
    body.content = body.content.map((block: Record<string, unknown>) => {
      if (block.type === 'tool_use' && blockedNames.has(block.name as string)) {
        const match = blockable.find(m => m.tc.toolName === block.name);
        const warning = `[BLOCKED by Bastion Tool Guard] Tool "${block.name}" was blocked: ${match?.ruleMatch?.rule.name ?? 'unknown rule'} (${match?.ruleMatch?.rule.severity ?? 'unknown'})`;
        return { type: 'text', text: warning };
      }
      return block;
    });
    // Change stop_reason from tool_use to end_turn since tools were removed
    if (body.stop_reason === 'tool_use') {
      body.stop_reason = 'end_turn';
    }
    return JSON.stringify(body);
  }

  // OpenAI format: choices[].message.tool_calls
  if (Array.isArray(body.choices)) {
    const warnings: string[] = [];
    for (const choice of body.choices as Record<string, unknown>[]) {
      const msg = choice.message as Record<string, unknown> | undefined;
      if (!msg?.tool_calls || !Array.isArray(msg.tool_calls)) continue;

      const kept: unknown[] = [];
      for (const tc of msg.tool_calls as Record<string, unknown>[]) {
        const fn = tc.function as Record<string, unknown> | undefined;
        const name = fn?.name as string | undefined;
        if (name && blockedNames.has(name)) {
          const match = blockable.find(m => m.tc.toolName === name);
          warnings.push(`[BLOCKED by Bastion Tool Guard] Tool "${name}" was blocked: ${match?.ruleMatch?.rule.name ?? 'unknown rule'} (${match?.ruleMatch?.rule.severity ?? 'unknown'})`);
        } else {
          kept.push(tc);
        }
      }
      msg.tool_calls = kept.length > 0 ? kept : undefined;
      if (warnings.length > 0) {
        msg.content = ((msg.content as string) ?? '') + '\n' + warnings.join('\n');
      }
      if (kept.length === 0) {
        choice.finish_reason = 'stop';
      }
    }
    return JSON.stringify(body);
  }

  // Unknown format — return body with warning prepended
  return JSON.stringify(body);
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

        // Replace dangerous tool_use blocks with text warnings in the response body
        // (consistent with streaming guard behavior — client sees warning, not 403)
        const modified = replaceBlockedToolCalls(context.parsedBody, blockable);
        return { modifiedBody: modified };
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
