import type { Plugin, RequestContext, PluginRequestResult, ResponseCompleteContext } from '../types.js';
import { AuditLogRepository } from '../../storage/repositories/audit-log.js';
import { isPollingRequest } from '../../proxy/providers/classify.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('audit-plugin');

export interface AuditLoggerConfig {
  rawData: boolean;
  rawMaxBytes: number;
  summaryMaxBytes: number;
}

export function createAuditLoggerPlugin(db: Database.Database, config: AuditLoggerConfig): Plugin {
  const auditRepo = new AuditLogRepository(db);

  // Store request bodies temporarily until response is complete
  const pendingRequests = new Map<string, string>();

  return {
    name: 'audit-logger',
    priority: 25,

    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      // Capture request body for later storage
      pendingRequests.set(context.id, context.body);
    },

    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      const requestBody = pendingRequests.get(context.request.id) ?? '';
      pendingRequests.delete(context.request.id);

      // Skip high-frequency polling requests — unless DLP flagged sensitive data
      if (isPollingRequest(context.request.provider, context.request.path) && !context.request.dlpHit) return;

      try {
        // Avoid duplicates — DLP auto-audit may have already stored this request
        if (auditRepo.hasEntry(context.request.id)) return;

        // Read flags set by upstream plugins during onRequest/onResponse/onResponseComplete
        const dlpHit = Boolean(context.request.dlpHit);
        const toolGuardHit = Boolean(context.request.toolGuardHit);

        auditRepo.insert({
          id: crypto.randomUUID(),
          request_id: context.request.id,
          requestBody,
          responseBody: context.body,
          dlpHit,
          toolGuardHit,
          rawData: config.rawData,
          rawMaxBytes: config.rawMaxBytes,
          summaryMaxBytes: config.summaryMaxBytes,
        });
        log.debug('Audit entry stored', { requestId: context.request.id });
      } catch (err) {
        log.warn('Failed to store audit entry', { error: (err as Error).message });
      }
    },
  };
}
