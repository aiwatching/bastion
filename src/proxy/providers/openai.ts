import { registerProvider, type ProviderConfig } from './index.js';

export const openaiProvider: ProviderConfig = {
  name: 'openai',
  baseUrl: 'https://api.openai.com',
  authHeader: 'authorization',
  transformHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'authorization' || lower === 'content-type' || lower === 'accept' ||
          lower === 'openai-organization' || lower === 'openai-project') {
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
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    };
  },
};

export function registerOpenAIProvider(): void {
  registerProvider('/v1/chat/completions', openaiProvider);
  registerProvider('/v1/responses', openaiProvider);
}
