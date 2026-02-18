import type { ResponseCompleteContext } from '../plugins/types.js';
import { calculateCost } from './pricing.js';

export interface UsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  latencyMs: number;
}

export function extractMetrics(context: ResponseCompleteContext): UsageMetrics {
  const { usage, latencyMs, request } = context;

  const costUsd = calculateCost(
    request.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheCreationTokens,
    usage.cacheReadTokens,
  );

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd,
    latencyMs,
  };
}
