import type { Plugin, RequestContext, ResponseCompleteContext, PluginRequestResult } from '../types.js';
import { ResponseCache } from '../../optimizer/cache.js';
import { trimContent } from '../../optimizer/trimmer.js';
import { reorderForCache } from '../../optimizer/reorder.js';
import { estimateTokens } from '../../optimizer/estimator.js';
import { OptimizerEventsRepository } from '../../storage/repositories/optimizer-events.js';
import { isLLMProvider } from '../../proxy/providers/classify.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('optimizer-plugin');

export interface TokenOptimizerConfig {
  cache: boolean;
  cacheTtlSeconds?: number;
  trimWhitespace: boolean;
  reorderForCache: boolean;
}

/**
 * Check if a request is part of an agentic loop (contains tool_result).
 * These should not be cached because the same tool call may produce different results.
 */
function isAgenticRequest(parsedBody: Record<string, unknown>): boolean {
  const messages = parsedBody.messages;
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    // Anthropic format: content array with tool_result blocks
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === 'tool_result') return true;
      }
    }
    // OpenAI format: role === 'tool'
    if (msg.role === 'tool') return true;
  }
  return false;
}

export function createTokenOptimizerPlugin(db: Database.Database, config: TokenOptimizerConfig): Plugin {
  const ttl = config.cacheTtlSeconds ?? 300;
  const cache = config.cache ? new ResponseCache(db, ttl) : null;
  const optimizerRepo = new OptimizerEventsRepository(db);

  return {
    name: 'token-optimizer',
    priority: 30,
    version: '1.0.0',
    apiVersion: 2,

    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      // GET/HEAD have no request body to optimize/cache
      if (context.method === 'GET' || context.method === 'HEAD') return;

      const originalLength = context.body.length;

      // Skip cache for non-LLM providers, streaming requests, and agentic loops
      // Only optimize/cache LLM providers — skip messaging platforms entirely
      if (!isLLMProvider(context.provider)) return;

      const skipCache = context.isStreaming || isAgenticRequest(context.parsedBody);

      // Check cache first
      if (cache && !skipCache) {
        const cached = cache.get(context.provider, context.model, context.body);
        if (cached) {
          log.info('Serving cached response', { requestId: context.id, model: context.model });

          // Record cache hit event
          optimizerRepo.insert({
            id: crypto.randomUUID(),
            request_id: context.id,
            cache_hit: 1,
            original_length: originalLength,
            trimmed_length: originalLength,
            chars_saved: 0,
            tokens_saved_estimate: 0,
          });

          return {
            shortCircuit: {
              statusCode: 200,
              headers: { 'content-type': 'application/json', 'x-bastion-cache': 'hit' },
              body: cached,
            },
          };
        }
      }

      let modifiedBody = context.body;

      // Trim whitespace
      if (config.trimWhitespace) {
        const { trimmed, savedChars } = trimContent(modifiedBody);
        if (savedChars > 0) {
          log.debug('Trimmed whitespace', { savedChars });
          modifiedBody = trimmed;
        }
      }

      // Reorder for cache optimization
      if (config.reorderForCache) {
        modifiedBody = reorderForCache(modifiedBody, context.provider);
      }

      const charsSaved = originalLength - modifiedBody.length;

      if (charsSaved > 0 || modifiedBody !== context.body) {
        // Record optimization event
        optimizerRepo.insert({
          id: crypto.randomUUID(),
          request_id: context.id,
          cache_hit: 0,
          original_length: originalLength,
          trimmed_length: modifiedBody.length,
          chars_saved: Math.max(0, charsSaved),
          tokens_saved_estimate: Math.max(0, estimateTokens(context.body) - estimateTokens(modifiedBody)),
        });
      }

      if (modifiedBody !== context.body) {
        return { modifiedBody };
      }
    },

    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      // Cache successful non-streaming, non-agentic responses
      if (
        cache &&
        isLLMProvider(context.request.provider) &&
        !context.isStreaming &&
        context.statusCode === 200 &&
        context.body &&
        !isAgenticRequest(context.request.parsedBody)
      ) {
        cache.set(
          context.request.provider,
          context.request.model,
          context.request.body,
          context.body,
          context.usage.inputTokens,
          context.usage.outputTokens,
        );
      }
    },
  };
}
