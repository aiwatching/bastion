import type { Plugin, RequestContext, PluginRequestResult } from '../types.js';
import { scanText, getPatterns, type DlpPattern } from '../../dlp/engine.js';
import type { DlpAction } from '../../dlp/actions.js';
import { DlpEventsRepository } from '../../storage/repositories/dlp-events.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('dlp-plugin');

const SNIPPET_CONTEXT = 25; // chars of context on each side of match

export interface DlpScannerConfig {
  action: DlpAction;
  patterns: string[];
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
  const patterns: DlpPattern[] = getPatterns(config.patterns);

  return {
    name: 'dlp-scanner',
    priority: 20,

    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      const result = scanText(context.body, patterns, config.action);

      if (result.findings.length === 0) return;

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

      if (result.action === 'block') {
        return {
          blocked: {
            reason: `Request blocked: sensitive data detected (${result.findings.map((f) => f.patternName).join(', ')})`,
          },
        };
      }

      if (result.action === 'redact' && result.redactedBody) {
        return { modifiedBody: result.redactedBody };
      }

      // 'warn' and 'pass' — continue without modification
    },
  };
}
