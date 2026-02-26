import type {
  Plugin,
  RequestContext,
  ResponseInterceptContext,
  ResponseCompleteContext,
  PluginRequestResult,
  PluginResponseResult,
} from '../types.js';
import { scanText, type DlpPattern } from '../../dlp/engine.js';
import type { DlpAction } from '../../dlp/actions.js';
import { DlpEventsRepository } from '../../storage/repositories/dlp-events.js';
import { DlpPatternsRepository } from '../../storage/repositories/dlp-patterns.js';
import { AuditLogRepository } from '../../storage/repositories/audit-log.js';
import { AiValidator, type AiValidatorConfig } from '../../dlp/ai-validator.js';
import { highConfidencePatterns } from '../../dlp/patterns/high-confidence.js';
import { validatedPatterns } from '../../dlp/patterns/validated.js';
import { contextAwarePatterns } from '../../dlp/patterns/context-aware.js';
import { promptInjectionPatterns } from '../../dlp/patterns/prompt-injection.js';
import { syncRemotePatterns, startPeriodicSync } from '../../dlp/remote-sync.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('dlp-plugin');

const SNIPPET_CONTEXT = 25; // chars of context on each side of match

export interface DlpScannerConfig {
  action: DlpAction;
  patterns: string[];
  remotePatterns?: {
    url: string;
    branch: string;
    syncOnStart: boolean;
    syncIntervalMinutes: number;
  };
  aiValidation?: AiValidatorConfig;
  /** Live getter for action — when provided, overrides static `action` field */
  getAction?: () => DlpAction;
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
  const getAction = (): DlpAction => config.getAction ? config.getAction() : config.action;

  // AI validation — optional, default off
  const aiValidator = config.aiValidation
    ? new AiValidator(config.aiValidation)
    : null;

  // Seed built-in patterns from the 3 pattern files
  const allBuiltins: DlpPattern[] = [
    ...highConfidencePatterns,
    ...validatedPatterns,
    ...contextAwarePatterns,
    ...promptInjectionPatterns,
  ];
  patternsRepo.seedBuiltins(allBuiltins, config.patterns);

  // Sync remote patterns from signature repo (if configured)
  if (config.remotePatterns?.url) {
    if (config.remotePatterns.syncOnStart !== false) {
      try {
        syncRemotePatterns(config.remotePatterns, patternsRepo, config.patterns);
      } catch (err) {
        log.warn('Remote pattern sync failed on startup', { error: (err as Error).message });
      }
    }
    if (config.remotePatterns.syncIntervalMinutes > 0) {
      startPeriodicSync(config.remotePatterns, patternsRepo, config.patterns);
    }
  }

  return {
    name: 'dlp-scanner',
    priority: 20,

    // ── Request-side: scan outgoing requests to LLM ──
    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      // GET/HEAD have no meaningful request body to scan
      if (context.method === 'GET' || context.method === 'HEAD') return;

      const patterns = patternsRepo.getEnabled();
      const result = scanText(context.body, patterns, getAction());

      if (result.findings.length === 0) return;

      // AI validation: filter out false positives
      if (aiValidator?.ready) {
        result.findings = await aiValidator.validate(result.findings, context.body);
        if (result.findings.length === 0) return;
      }

      // Record DLP events
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

      // Set DLP flags on context for downstream plugins (audit-logger, metrics-collector)
      context.dlpHit = true;
      context.dlpAction = result.action;
      context.dlpFindings = result.findings.length;

      // Auto-audit on DLP hit
      if (result.action === 'block') {
        const blockReason = `Request blocked: sensitive data detected (${result.findings.map((f) => f.patternName).join(', ')})`;
        try {
          auditRepo.insert({
            id: crypto.randomUUID(),
            request_id: context.id,
            requestBody: context.body,
            responseBody: JSON.stringify({ error: blockReason }),
            dlpHit: true,
          });
        } catch (err) {
          log.warn('Failed to write DLP auto-audit for blocked request', { error: (err as Error).message });
        }
        return { blocked: { reason: blockReason } };
      }

      if (result.action === 'redact' && result.redactedBody) {
        return { modifiedBody: result.redactedBody };
      }
    },

    // ── Response-side: scan LLM response BEFORE sending to client (non-streaming only) ──
    async onResponse(context: ResponseInterceptContext): Promise<PluginResponseResult | void> {
      if (context.isStreaming) return; // streaming handled in onResponseComplete (post-send)

      const patterns = patternsRepo.getEnabled();
      const result = scanText(context.body, patterns, getAction());

      if (result.findings.length === 0) return;

      // AI validation on response findings
      if (aiValidator?.ready) {
        result.findings = await aiValidator.validate(result.findings, context.body);
        if (result.findings.length === 0) return;
      }

      // Record response-side DLP events
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
          request_id: context.request.id,
          pattern_name: finding.patternName,
          pattern_category: finding.patternCategory,
          action: result.action,
          match_count: finding.matchCount,
          original_snippet: originalSnippet,
          redacted_snippet: redactedSnippet,
          direction: 'response',
        });
      }

      log.info('DLP response findings', {
        requestId: context.request.id,
        direction: 'response',
        action: result.action,
        findings: result.findings.map((f) => f.patternName),
      });

      // Set DLP flags on context for downstream plugins (audit-logger reads these)
      context.request.dlpHit = true;
      context.request.dlpAction = result.action;
      context.request.dlpFindings = (context.request.dlpFindings ?? 0) + result.findings.length;

      // Apply action: block or redact the response
      if (result.action === 'block') {
        return {
          blocked: {
            reason: `Response blocked: sensitive data detected (${result.findings.map((f) => f.patternName).join(', ')})`,
          },
        };
      }

      if (result.action === 'redact' && result.redactedBody) {
        return { modifiedBody: result.redactedBody };
      }

      // 'warn' and 'pass' — let through without modification
    },

    // ── Post-send: streaming response detection (can't block, but record + audit) ──
    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      if (!context.isStreaming) return;

      // Skip DLP scanning for very large streaming bodies (data already sent, can only warn)
      if (context.body.length > 1024 * 1024) {
        log.debug('Skipping DLP scan for large streaming response', {
          requestId: context.request.id,
          bodyLength: context.body.length,
        });
        return;
      }

      const patterns = patternsRepo.getEnabled();
      const responseResult = scanText(context.body, patterns, 'warn');
      if (responseResult.findings.length === 0) return;

      if (aiValidator?.ready) {
        responseResult.findings = await aiValidator.validate(responseResult.findings, context.body);
        if (responseResult.findings.length === 0) return;
      }

      for (const finding of responseResult.findings) {
        const firstMatch = finding.matches[0] ?? '';
        dlpRepo.insert({
          id: crypto.randomUUID(),
          request_id: context.request.id,
          pattern_name: finding.patternName,
          pattern_category: finding.patternCategory,
          action: 'warn',
          match_count: finding.matchCount,
          original_snippet: extractSnippet(context.body, firstMatch),
          redacted_snippet: null,
          direction: 'response',
        });
      }

      log.info('DLP streaming response findings (post-send)', {
        requestId: context.request.id,
        findings: responseResult.findings.map((f) => f.patternName),
      });

      try {
        if (!auditRepo.hasEntry(context.request.id)) {
          auditRepo.insert({
            id: crypto.randomUUID(),
            request_id: context.request.id,
            requestBody: context.request.body,
            responseBody: context.body,
            dlpHit: true,
          });
        } else {
          auditRepo.markDlpHit(context.request.id);
        }
      } catch (err) {
        log.warn('Failed to write DLP streaming response auto-audit', { error: (err as Error).message });
      }
    },
  };
}
