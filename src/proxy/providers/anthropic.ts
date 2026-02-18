import { registerProvider, type ProviderConfig } from './index.js';

export const anthropicProvider: ProviderConfig = {
  name: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  authHeader: 'x-api-key',
  transformHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      // Pass through anthropic-specific headers and standard headers
      if (lower === 'x-api-key' || lower === 'authorization' ||
          lower === 'anthropic-version' || lower === 'anthropic-beta' ||
          lower === 'content-type' || lower === 'accept') {
        result[key] = value;
      }
    }
    return result;
  },
  extractModel(body: Record<string, unknown>): string {
    return (body.model as string) ?? 'unknown';
  },
  extractUsage(body: Record<string, unknown>): {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  } {
    const usage = body.usage as Record<string, number> | undefined;
    if (!usage) return { inputTokens: 0, outputTokens: 0 };
    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    };
  },
};

export function registerAnthropicProvider(): void {
  registerProvider('/v1/messages', anthropicProvider);
}
