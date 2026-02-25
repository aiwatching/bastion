import type {
  Plugin,
  RequestContext,
  PluginRequestResult,
  ResponseInterceptContext,
  ResponseCompleteContext,
  PluginResponseResult,
} from '../types.js';
import { ToolCallsRepository } from '../../storage/repositories/tool-calls.js';
import { extractToolCalls, type ExtractedToolCall } from '../../tool-guard/extractor.js';
import { matchRules, BUILTIN_RULES, type RuleMatch } from '../../tool-guard/rules.js';
import { dispatchAlert, shouldAlert, type AlertConfig } from '../../tool-guard/alert.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('tool-guard');

export interface ToolGuardConfig {
  enabled: boolean;
  action: 'audit' | 'block';
  blockMinSeverity: string;
  alertMinSeverity: string;
  alertDesktop: boolean;
  alertWebhookUrl: string;
}

interface MatchedToolCall {
  tc: ExtractedToolCall;
  ruleMatch: RuleMatch | null;
}

function analyzeToolCalls(body: string, isStreaming: boolean): MatchedToolCall[] {
  const toolCalls = extractToolCalls(body, isStreaming);
  return toolCalls.map(tc => ({
    tc,
    ruleMatch: matchRules(tc.toolName, tc.toolInput, BUILTIN_RULES),
  }));
}

export function createToolGuardPlugin(db: Database.Database, config: ToolGuardConfig): Plugin {
  const repo = new ToolCallsRepository(db);
  const action = config.action ?? 'audit';
  const blockMinSeverity = config.blockMinSeverity ?? 'critical';

  const alertConfig: AlertConfig = {
    minSeverity: config.alertMinSeverity ?? 'high',
    desktop: config.alertDesktop ?? true,
    webhookUrl: config.alertWebhookUrl ?? '',
  };

  /** Record tool calls to DB and dispatch alerts. Returns count of flagged calls. */
  function recordAndAlert(
    matches: MatchedToolCall[],
    requestId: string,
    sessionId?: string,
  ): number {
    let flaggedCount = 0;
    for (const { tc, ruleMatch } of matches) {
      const inputStr = typeof tc.toolInput === 'string'
        ? tc.toolInput
        : JSON.stringify(tc.toolInput);

      repo.insert({
        id: crypto.randomUUID(),
        request_id: requestId,
        tool_name: tc.toolName,
        tool_input: inputStr,
        rule_id: ruleMatch?.rule.id ?? null,
        rule_name: ruleMatch?.rule.name ?? null,
        severity: ruleMatch?.rule.severity ?? null,
        category: ruleMatch?.rule.category ?? null,
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
        });

        dispatchAlert(alertConfig, tc.toolName, ruleMatch, requestId, sessionId);
      }
    }
    return flaggedCount;
  }

  return {
    name: 'tool-guard',
    priority: 15,

    // ── Set streaming block flag if action=block and request is streaming ──
    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      if (action === 'block' && context.isStreaming) {
        context._toolGuardStreamBlock = blockMinSeverity;
      }
    },

    // ── Pre-send: block dangerous tool calls in non-streaming responses ──
    async onResponse(context: ResponseInterceptContext): Promise<PluginResponseResult | void> {
      if (action !== 'block') return;
      if (context.isStreaming) return; // streaming handled in onResponseComplete (post-send audit only)

      const matches = analyzeToolCalls(context.body, false);
      if (matches.length === 0) return;

      // Check if any flagged call meets the block severity threshold
      const blockable = matches.filter(
        m => m.ruleMatch && shouldAlert(m.ruleMatch.rule.severity, blockMinSeverity),
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
        return { blocked: { reason } };
      }
    },

    // ── Post-send: audit all tool calls (streaming + non-streaming fallback) ──
    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      // Skip if onResponse already recorded (non-streaming + action=block)
      if (context.request._toolGuardRecorded) return;

      try {
        const matches = analyzeToolCalls(context.body, context.isStreaming);
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
