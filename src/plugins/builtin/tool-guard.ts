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
import { PluginEventsRepository } from '../../storage/repositories/plugin-events.js';
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
  piEscalation?: {
    enabled: boolean;
    scoreThreshold: number;
    overrideSeverity: string;
    scope: 'session' | 'request';
    ttlMinutes: number;
  };
  /** Live getter — when provided, overrides static fields for hot-reload */
  getLiveConfig?: () => { action: string; recordAll: boolean; blockMinSeverity: string; alertMinSeverity: string };
}

// ── PI Escalation state (module-level, exported for api-routes) ──

export interface PiEscalationEntry {
  sessionId: string;
  score: number;
  label: string;
  overrideSeverity: string;
  escalatedAt: number;
}

const piEscalationMap = new Map<string, PiEscalationEntry>();
let piEscalationTtlMs = 30 * 60000;

function cleanExpiredPiEscalations(): void {
  if (piEscalationTtlMs <= 0) return;
  const now = Date.now();
  for (const [key, entry] of piEscalationMap) {
    if (now - entry.escalatedAt > piEscalationTtlMs) {
      piEscalationMap.delete(key);
    }
  }
}

export function getPiEscalations(): PiEscalationEntry[] {
  cleanExpiredPiEscalations();
  return Array.from(piEscalationMap.values());
}

export function resetPiEscalation(sessionId: string): boolean {
  return piEscalationMap.delete(sessionId);
}

export function resetAllPiEscalations(): number {
  const count = piEscalationMap.size;
  piEscalationMap.clear();
  return count;
}

export function getPiEscalationCount(): number {
  cleanExpiredPiEscalations();
  return piEscalationMap.size;
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

export function createToolGuardPlugin(db: Database.Database, config: ToolGuardConfig, eventBus?: import('../event-bus.js').PluginEventBus): Plugin {
  const repo = new ToolCallsRepository(db);
  const rulesRepo = new ToolGuardRulesRepository(db);
  const auditRepo = new AuditLogRepository(db);
  const pluginEventsRepo = new PluginEventsRepository(db);

  // Seed built-in rules on first init (INSERT OR IGNORE preserves user toggles)
  rulesRepo.seedBuiltins(BUILTIN_RULES);

  // ── PI Escalation setup ──
  const piCfg = config.piEscalation;
  if (piCfg) {
    piEscalationTtlMs = (piCfg.ttlMinutes ?? 30) * 60000;
  }

  if (piCfg?.enabled && eventBus) {
    eventBus.on('pi:detected', (data: unknown) => {
      const ev = data as { score?: number; label?: string; sessionId?: string; requestId?: string };
      if (!ev.sessionId) return;
      if ((ev.score ?? 0) < (piCfg.scoreThreshold ?? 0.8)) return;

      const entry: PiEscalationEntry = {
        sessionId: ev.sessionId,
        score: ev.score ?? 0,
        label: ev.label ?? 'injection',
        overrideSeverity: piCfg.overrideSeverity ?? 'medium',
        escalatedAt: Date.now(),
      };
      piEscalationMap.set(ev.sessionId, entry);

      log.warn('PI escalation triggered', { sessionId: ev.sessionId, score: ev.score, override: entry.overrideSeverity });

      // Audit log to plugin_events table
      try {
        pluginEventsRepo.insertEvent('tool-guard', ev.requestId ?? null, {
          type: 'pi-escalation',
          severity: entry.overrideSeverity,
          rule: 'pi-escalation',
          detail: `PI score ${ev.score?.toFixed(2)} >= ${piCfg.scoreThreshold} → blockMinSeverity override to ${entry.overrideSeverity} (scope=${piCfg.scope})`,
        });
      } catch (err) {
        log.warn('Failed to write PI escalation audit', { error: (err as Error).message });
      }

      eventBus.emit('toolguard:pi-escalation', {
        sessionId: ev.sessionId,
        score: ev.score,
        label: ev.label,
        overrideSeverity: entry.overrideSeverity,
        scope: piCfg.scope,
      });
    });

    // Indirect injection always escalates (external data injection is inherently high risk)
    eventBus.on('pi:indirect-injection', (data: unknown) => {
      const ev = data as { sessionId?: string; maxScore?: number; detections?: number };
      if (!ev.sessionId) return;

      const entry: PiEscalationEntry = {
        sessionId: ev.sessionId,
        score: ev.maxScore ?? 0,
        label: 'indirect-injection',
        overrideSeverity: piCfg.overrideSeverity ?? 'medium',
        escalatedAt: Date.now(),
      };
      piEscalationMap.set(ev.sessionId, entry);

      log.warn('PI indirect-injection escalation triggered', { sessionId: ev.sessionId, score: ev.maxScore, detections: ev.detections });

      try {
        pluginEventsRepo.insertEvent('tool-guard', null, {
          type: 'pi-indirect-escalation',
          severity: entry.overrideSeverity,
          rule: 'pi-indirect-escalation',
          detail: `Indirect injection detected in tool_result (score ${(ev.maxScore ?? 0).toFixed(2)}, ${ev.detections ?? 1} detections) → blockMinSeverity override to ${entry.overrideSeverity}`,
        });
      } catch (err) {
        log.warn('Failed to write PI indirect escalation audit', { error: (err as Error).message });
      }

      eventBus.emit('toolguard:pi-escalation', {
        sessionId: ev.sessionId,
        score: ev.maxScore,
        label: 'indirect-injection',
        overrideSeverity: entry.overrideSeverity,
        scope: piCfg.scope,
      });
    });
  }

  // Live config readers — support hot-reload from Dashboard
  const getAction = () => config.getLiveConfig ? config.getLiveConfig().action : config.action;
  const getRecordAll = () => config.getLiveConfig ? config.getLiveConfig().recordAll : config.recordAll;
  const getBlockMinSeverity = () => config.getLiveConfig ? config.getLiveConfig().blockMinSeverity : config.blockMinSeverity;
  const getAlertMinSeverity = () => config.getLiveConfig ? config.getLiveConfig().alertMinSeverity : config.alertMinSeverity;

  // Severity rank for comparison (lower rank = more strict)
  const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

  /** Get effective blockMinSeverity for a request context.
   *  Combines threat-scorer path and PI escalation path, taking the stricter (lower rank) of the two. */
  function getEffectiveBlockMinSeverity(context: RequestContext): string {
    // Path 1: threat-level based escalation
    let threatSeverity: string;
    const threatLevel = context._threatLevel;
    if (threatLevel === 'critical') threatSeverity = 'low';
    else if (threatLevel === 'high') threatSeverity = 'medium';
    else if (threatLevel === 'elevated') threatSeverity = 'high';
    else threatSeverity = getBlockMinSeverity();

    // Path 2: PI escalation
    if (piCfg?.enabled && context.sessionId) {
      cleanExpiredPiEscalations();
      const piEntry = piEscalationMap.get(context.sessionId);
      if (piEntry) {
        const piSeverity = piEntry.overrideSeverity;
        const piRank = SEVERITY_RANK[piSeverity] ?? 99;
        const threatRank = SEVERITY_RANK[threatSeverity] ?? 99;
        if (piRank < threatRank) {
          context._piEscalated = true;
          context._piEscalationOverride = piSeverity;
          return piSeverity;
        }
        // Even if threat path is stricter, mark PI escalation as active
        context._piEscalated = true;
        context._piEscalationOverride = piSeverity;
      }
    }

    return threatSeverity;
  }

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

        eventBus?.emit('toolguard:alert', {
          requestId,
          sessionId,
          toolName: tc.toolName,
          ruleId: ruleMatch.rule.id,
          ruleName: ruleMatch.rule.name,
          severity: ruleMatch.rule.severity,
          category: ruleMatch.rule.category,
          action: actionResult,
          matchedText: ruleMatch.matchedText,
        });
      }
    }
    return flaggedCount;
  }

  return {
    name: 'tool-guard',
    priority: 5,
    version: '1.0.0',
    apiVersion: 2,

    // ── Load rules from DB and set streaming block flag ──
    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      const rules = rulesRepo.getEnabled();
      context._toolGuardRules = rules;
      const effectiveBlockMin = getEffectiveBlockMinSeverity(context);
      log.debug('onRequest', { action: getAction(), recordAll: getRecordAll(), isStreaming: context.isStreaming, effectiveBlockMin, threatLevel: context._threatLevel, piEscalated: context._piEscalated });
      if (getAction() === 'block' && context.isStreaming) {
        context._toolGuardStreamBlock = effectiveBlockMin;
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

      // Check if any flagged call meets the block severity threshold (may be escalated by threat level)
      const currentBlockMin = getEffectiveBlockMinSeverity(context.request);
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
      } finally {
        // Request-scope PI escalation: remove after this request completes
        if (piCfg?.enabled && piCfg.scope === 'request' && context.request.sessionId && context.request._piEscalated) {
          piEscalationMap.delete(context.request.sessionId);
        }
      }
    },
  };
}
