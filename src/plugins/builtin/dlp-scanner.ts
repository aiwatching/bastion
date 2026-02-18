import type { Plugin, RequestContext, PluginRequestResult } from '../types.js';
import { scanText, getPatterns, type DlpPattern } from '../../dlp/engine.js';
import type { DlpAction } from '../../dlp/actions.js';
import { DlpEventsRepository } from '../../storage/repositories/dlp-events.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('dlp-plugin');

export interface DlpScannerConfig {
  action: DlpAction;
  patterns: string[];
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

      // Record DLP events
      for (const finding of result.findings) {
        dlpRepo.insert({
          id: crypto.randomUUID(),
          request_id: context.id,
          pattern_name: finding.patternName,
          pattern_category: finding.patternCategory,
          action: result.action,
          match_count: finding.matchCount,
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
