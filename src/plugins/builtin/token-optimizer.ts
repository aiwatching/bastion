import type { Plugin, RequestContext, ResponseCompleteContext, PluginRequestResult } from '../types.js';
import { ResponseCache } from '../../optimizer/cache.js';
import { trimContent } from '../../optimizer/trimmer.js';
import { reorderForCache } from '../../optimizer/reorder.js';
import { estimateTokens } from '../../optimizer/estimator.js';
import { OptimizerEventsRepository } from '../../storage/repositories/optimizer-events.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('optimizer-plugin');

export interface TokenOptimizerConfig {
  cache: boolean;
  trimWhitespace: boolean;
  reorderForCache: boolean;
}

export function createTokenOptimizerPlugin(db: Database.Database, config: TokenOptimizerConfig): Plugin {
  const cache = config.cache ? new ResponseCache(db) : null;
  const optimizerRepo = new OptimizerEventsRepository(db);

  return {
    name: 'token-optimizer',
    priority: 30,

    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      const originalLength = context.body.length;

      // Check cache first (only for non-streaming requests)
      if (cache && !context.isStreaming) {
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
      // Cache successful non-streaming responses
      if (cache && !context.isStreaming && context.statusCode === 200 && context.body) {
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
