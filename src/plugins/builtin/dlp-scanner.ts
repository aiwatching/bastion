import type { Plugin, RequestContext, ResponseCompleteContext, PluginRequestResult } from '../types.js';
import { scanText, type DlpPattern } from '../../dlp/engine.js';
import type { DlpAction } from '../../dlp/actions.js';
import { DlpEventsRepository } from '../../storage/repositories/dlp-events.js';
import { DlpPatternsRepository } from '../../storage/repositories/dlp-patterns.js';
import { AuditLogRepository } from '../../storage/repositories/audit-log.js';
import { AiValidator, type AiValidatorConfig } from '../../dlp/ai-validator.js';
import { highConfidencePatterns } from '../../dlp/patterns/high-confidence.js';
import { validatedPatterns } from '../../dlp/patterns/validated.js';
import { contextAwarePatterns } from '../../dlp/patterns/context-aware.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('dlp-plugin');

const SNIPPET_CONTEXT = 25; // chars of context on each side of match

export interface DlpScannerConfig {
  action: DlpAction;
  patterns: string[];
  aiValidation?: AiValidatorConfig;
}

/**
 * Extract a context snippet around the first match in the text.
 * Returns up to 50 chars of context centered on the match.
 */
function extractSnippet(text: string, match: string): string {
  const idx = text.indexOf(match);
  if (idx === -1) return match.slice(0, 50);
  const start = Math.max(0, idx - SNIPPET_CONTEXT);
  const end = Math.min(text.length, idx + match.length + SNIPPET_CONTEXT);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

export function createDlpScannerPlugin(db: Database.Database, config: DlpScannerConfig): Plugin {
  const dlpRepo = new DlpEventsRepository(db);
  const patternsRepo = new DlpPatternsRepository(db);
  const auditRepo = new AuditLogRepository(db);

  // AI validation — optional, default off
  const aiValidator = config.aiValidation
    ? new AiValidator(config.aiValidation)
    : null;

  // Seed built-in patterns from the 3 pattern files
  const allBuiltins: DlpPattern[] = [
    ...highConfidencePatterns,
    ...validatedPatterns,
    ...contextAwarePatterns,
  ];
  patternsRepo.seedBuiltins(allBuiltins, config.patterns);

  // Track pending audits: requestId → requestBody
  const pendingAudits = new Map<string, string>();

  return {
    name: 'dlp-scanner',
    priority: 20,

    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      // Load patterns from DB each request (12 rows, SQLite is fast)
      const patterns = patternsRepo.getEnabled();
      const result = scanText(context.body, patterns, config.action);

      if (result.findings.length === 0) return;

      // AI validation: filter out false positives
      if (aiValidator?.ready) {
        result.findings = await aiValidator.validate(result.findings, context.body);
        if (result.findings.length === 0) return;
      }

      // Record DLP events with snippets
      for (const finding of result.findings) {
        const firstMatch = finding.matches[0] ?? '';
        const originalSnippet = extractSnippet(context.body, firstMatch);

        let redactedSnippet: string | null = null;
        if (result.action === 'redact' && result.redactedBody) {
          const redactedTag = `[${finding.patternName.toUpperCase()}_REDACTED]`;
          redactedSnippet = extractSnippet(result.redactedBody, redactedTag);
        }

        dlpRepo.insert({
          id: crypto.randomUUID(),
          request_id: context.id,
          pattern_name: finding.patternName,
          pattern_category: finding.patternCategory,
          action: result.action,
          match_count: finding.matchCount,
          original_snippet: originalSnippet,
          redacted_snippet: redactedSnippet,
        });
      }

      log.info('DLP findings', {
        requestId: context.id,
        action: result.action,
        findings: result.findings.map((f) => f.patternName),
      });

      // Auto-audit on DLP hit
      if (result.action === 'block') {
        // Blocked requests won't reach onResponseComplete, write audit immediately
        const blockReason = `Request blocked: sensitive data detected (${result.findings.map((f) => f.patternName).join(', ')})`;
        try {
          auditRepo.insert({
            id: crypto.randomUUID(),
            request_id: context.id,
            requestBody: context.body,
            responseBody: JSON.stringify({ error: blockReason }),
          });
        } catch (err) {
          log.warn('Failed to write DLP auto-audit for blocked request', { error: (err as Error).message });
        }

        return {
          blocked: { reason: blockReason },
        };
      }

      // Non-block: stash request body for onResponseComplete
      pendingAudits.set(context.id, context.body);

      if (result.action === 'redact' && result.redactedBody) {
        return { modifiedBody: result.redactedBody };
      }

      // 'warn' and 'pass' — continue without modification
    },

    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      const requestBody = pendingAudits.get(context.request.id);
      if (!requestBody) return;
      pendingAudits.delete(context.request.id);

      try {
        // Avoid duplicate if audit-logger plugin already stored it
        if (auditRepo.hasEntry(context.request.id)) return;

        auditRepo.insert({
          id: crypto.randomUUID(),
          request_id: context.request.id,
          requestBody,
          responseBody: context.body,
        });
      } catch (err) {
        log.warn('Failed to write DLP auto-audit', { error: (err as Error).message });
      }
    },
  };
}
