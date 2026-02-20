/** Price per million tokens (USD) */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion?: number;
  cacheReadPerMillion?: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic — current generation
  'claude-opus-4-20250514': { inputPerMillion: 15, outputPerMillion: 75, cacheCreationPerMillion: 18.75, cacheReadPerMillion: 1.5 },
  'claude-sonnet-4-20250514': { inputPerMillion: 3, outputPerMillion: 15, cacheCreationPerMillion: 3.75, cacheReadPerMillion: 0.3 },
  'claude-sonnet-4-5-20250514': { inputPerMillion: 3, outputPerMillion: 15, cacheCreationPerMillion: 3.75, cacheReadPerMillion: 0.3 },
  'claude-haiku-3-5-20241022': { inputPerMillion: 0.80, outputPerMillion: 4, cacheCreationPerMillion: 1, cacheReadPerMillion: 0.08 },
  'claude-haiku-4-5-20241022': { inputPerMillion: 0.80, outputPerMillion: 4, cacheCreationPerMillion: 1, cacheReadPerMillion: 0.08 },
  // Anthropic — older naming convention (claude-3-5-* format)
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3, outputPerMillion: 15, cacheCreationPerMillion: 3.75, cacheReadPerMillion: 0.3 },
  'claude-3-5-sonnet-20240620': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku-20241022': { inputPerMillion: 0.80, outputPerMillion: 4, cacheCreationPerMillion: 1, cacheReadPerMillion: 0.08 },
  'claude-3-opus-20240229': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-3-sonnet-20240229': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-haiku-20240307': { inputPerMillion: 0.25, outputPerMillion: 1.25 },

  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'gpt-4.1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },

  // Gemini
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

export function getModelPricing(model: string): ModelPricing | undefined {
  // Exact match first
  if (PRICING[model]) return PRICING[model];

  // Normalize dots to hyphens for matching (e.g., claude-haiku-4.5 → claude-haiku-4-5)
  const normalized = model.replace(/\./g, '-');
  if (PRICING[normalized]) return PRICING[normalized];

  // Prefix match (handles dated model variants)
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key) || key.startsWith(model) ||
        normalized.startsWith(key) || key.startsWith(normalized)) {
      return pricing;
    }
  }

  return undefined;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0,
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  let cost = (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;

  if (pricing.cacheCreationPerMillion) {
    cost += (cacheCreationTokens / 1_000_000) * pricing.cacheCreationPerMillion;
  }
  if (pricing.cacheReadPerMillion) {
    cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  }

  return cost;
}
