import { registerProvider, type ProviderConfig } from './index.js';

export const geminiProvider: ProviderConfig = {
  name: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com',
  authHeader: 'x-goog-api-key',
  transformHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-goog-api-key' || lower === 'authorization' ||
          lower === 'content-type' || lower === 'accept') {
        result[key] = value;
      }
    }
    return result;
  },
  extractModel(body: Record<string, unknown>): string {
    // Gemini model is typically in the URL path, not body. Extract from body if present.
    return (body.model as string) ?? 'unknown';
  },
  extractUsage(body: Record<string, unknown>): {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  } {
    const metadata = body.usageMetadata as Record<string, number> | undefined;
    if (!metadata) return { inputTokens: 0, outputTokens: 0 };
    return {
      inputTokens: metadata.promptTokenCount ?? 0,
      outputTokens: metadata.candidatesTokenCount ?? 0,
    };
  },
};

export function registerGeminiProvider(): void {
  registerProvider('/v1beta/models', geminiProvider);
}
