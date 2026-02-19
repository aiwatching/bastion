import type { Plugin, ResponseCompleteContext } from '../types.js';
import { extractMetrics } from '../../metrics/collector.js';
import { RequestsRepository } from '../../storage/repositories/requests.js';
import { SessionsRepository } from '../../storage/repositories/sessions.js';
import { isPollingRequest } from '../../proxy/providers/classify.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';
import { basename } from 'node:path';

const log = createLogger('metrics-plugin');

/**
 * Extract project path from the request body's system prompt.
 * Claude Code includes "Primary working directory: /path/to/project" in system prompts.
 */
function extractProjectPath(parsedBody: Record<string, unknown>): string | null {
  let systemText = '';
  if (typeof parsedBody.system === 'string') {
    systemText = parsedBody.system;
  } else if (Array.isArray(parsedBody.system)) {
    for (const block of parsedBody.system) {
      if (typeof block === 'string') systemText += block;
      else if (block?.type === 'text' && typeof block.text === 'string') systemText += block.text;
    }
  }

  // Also check first user message for system-reminder style content
  if (!systemText && Array.isArray(parsedBody.messages)) {
    const first = parsedBody.messages[0];
    if (first?.role === 'user') {
      const content = first.content;
      if (typeof content === 'string') systemText = content;
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'string') systemText += block;
          else if (block?.type === 'text' && typeof block.text === 'string') systemText += block.text;
        }
      }
    }
  }

  const match = systemText.match(/Primary working directory:\s*([^\n]+)/);
  if (match) return match[1].trim();

  return null;
}

export function createMetricsCollectorPlugin(db: Database.Database): Plugin {
  const requestsRepo = new RequestsRepository(db);
  const sessionsRepo = new SessionsRepository(db);

  return {
    name: 'metrics-collector',
    priority: 10,

    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      // Skip high-frequency polling requests (e.g., Telegram getUpdates)
      if (isPollingRequest(context.request.provider, context.request.path)) return;

      const metrics = extractMetrics(context);
      const sessionId = context.request.sessionId ?? null;

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
        session_id: sessionId,
        api_key_hash: context.request.apiKeyHash ?? null,
      });

      // Persist session metadata with client info
      if (sessionId) {
        try {
          const projectPath = extractProjectPath(context.request.parsedBody);
          let label = projectPath ? basename(projectPath) : null;
          // Fallback label: use provider:model so sessions are identifiable
          if (!label) {
            const provider = context.request.provider;
            const model = context.request.model;
            label = model && model !== provider ? `${provider}:${model}` : provider;
          }
          const source = context.request.sessionSource ?? 'auto';
          sessionsRepo.upsert(sessionId, { label: label ?? undefined, source, projectPath: projectPath ?? undefined });
        } catch (err) {
          log.debug('Failed to upsert session', { error: (err as Error).message });
        }
      }

      log.debug('Recorded request metrics', {
        id: context.request.id,
        model: context.request.model,
        cost: metrics.costUsd.toFixed(6),
        latency: metrics.latencyMs,
        sessionId,
      });
    },
  };
}
