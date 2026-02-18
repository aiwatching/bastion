import type { Plugin, ResponseCompleteContext } from '../types.js';
import { extractMetrics } from '../../metrics/collector.js';
import { RequestsRepository } from '../../storage/repositories/requests.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('metrics-plugin');

export function createMetricsCollectorPlugin(db: Database.Database): Plugin {
  const requestsRepo = new RequestsRepository(db);

  return {
    name: 'metrics-collector',
    priority: 10,

    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      const metrics = extractMetrics(context);

      requestsRepo.insert({
        id: context.request.id,
        provider: context.request.provider,
        model: context.request.model,
        method: context.request.method,
        path: context.request.path,
        status_code: context.statusCode,
        input_tokens: metrics.inputTokens,
        output_tokens: metrics.outputTokens,
        cache_creation_tokens: metrics.cacheCreationTokens,
        cache_read_tokens: metrics.cacheReadTokens,
        cost_usd: metrics.costUsd,
        latency_ms: metrics.latencyMs,
        cached: 0,
        dlp_action: null,
        dlp_findings: 0,
        session_id: context.request.sessionId ?? null,
        api_key_hash: context.request.apiKeyHash ?? null,
      });

      log.debug('Recorded request metrics', {
        id: context.request.id,
        model: context.request.model,
        cost: metrics.costUsd.toFixed(6),
        latency: metrics.latencyMs,
      });
    },
  };
}
