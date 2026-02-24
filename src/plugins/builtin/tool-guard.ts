import type { Plugin, ResponseCompleteContext } from '../types.js';
import { ToolCallsRepository } from '../../storage/repositories/tool-calls.js';
import { extractToolCalls } from '../../tool-guard/extractor.js';
import { matchRules, BUILTIN_RULES } from '../../tool-guard/rules.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('tool-guard');

export interface ToolGuardConfig {
  enabled: boolean;
}

export function createToolGuardPlugin(db: Database.Database, _config: ToolGuardConfig): Plugin {
  const repo = new ToolCallsRepository(db);

  // Periodic purge (keep 7 days by default)
  const purgeInterval = setInterval(() => {
    try {
      const purged = repo.purgeOlderThan(168);
      if (purged > 0) log.debug('Purged old tool call entries', { purged });
    } catch { /* ignore */ }
  }, 60 * 60 * 1000);
  purgeInterval.unref();

  return {
    name: 'tool-guard',
    priority: 15,

    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      try {
        const toolCalls = extractToolCalls(context.body, context.isStreaming);
        if (toolCalls.length === 0) return;

        let flaggedCount = 0;

        for (const tc of toolCalls) {
          const ruleMatch = matchRules(tc.toolName, tc.toolInput, BUILTIN_RULES);
          const inputStr = typeof tc.toolInput === 'string'
            ? tc.toolInput
            : JSON.stringify(tc.toolInput);

          repo.insert({
            id: crypto.randomUUID(),
            request_id: context.request.id,
            tool_name: tc.toolName,
            tool_input: inputStr,
            rule_id: ruleMatch?.rule.id ?? null,
            rule_name: ruleMatch?.rule.name ?? null,
            severity: ruleMatch?.rule.severity ?? null,
            category: ruleMatch?.rule.category ?? null,
            provider: tc.provider,
            session_id: context.request.sessionId ?? null,
          });

          if (ruleMatch) {
            flaggedCount++;
            log.warn('Dangerous tool call detected', {
              requestId: context.request.id,
              toolName: tc.toolName,
              ruleId: ruleMatch.rule.id,
              severity: ruleMatch.rule.severity,
              matched: ruleMatch.matchedText,
            });
          }
        }

        if (flaggedCount > 0) {
          context.request.toolGuardHit = true;
          context.request.toolGuardFindings = flaggedCount;
        }

        log.debug('Tool calls recorded', {
          requestId: context.request.id,
          total: toolCalls.length,
          flagged: flaggedCount,
        });
      } catch (err) {
        log.warn('Tool guard processing failed', { error: (err as Error).message });
      }
    },
  };
}
