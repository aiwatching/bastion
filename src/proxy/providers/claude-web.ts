import { registerProvider, type ProviderConfig } from './index.js';

/**
 * Claude Web provider — for tools like OpenClaw that use claude.ai
 * session keys instead of the standard API.
 */
export const claudeWebProvider: ProviderConfig = {
  name: 'claude-web',
  baseUrl: 'https://claude.ai',
  authHeader: 'cookie',
  transformHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      // Pass through cookies, content-type, accept, and claude-specific headers
      if (
        lower === 'cookie' ||
        lower === 'content-type' ||
        lower === 'accept' ||
        lower === 'accept-language' ||
        lower === 'user-agent' ||
        lower === 'anthropic-client-sha' ||
        lower === 'anthropic-client-version'
      ) {
        result[key] = value;
      }
    }
    return result;
  },
  extractModel(body: Record<string, unknown>): string {
    // Claude web uses "model" field in completion requests
    return (body.model as string) ?? 'claude-web';
  },
  extractUsage(body: Record<string, unknown>): {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  } {
    // Claude web response format may vary; try common fields
    const usage = body.usage as Record<string, number> | undefined;
    if (!usage) return { inputTokens: 0, outputTokens: 0 };
    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    };
  },
};

export function registerClaudeWebProvider(): void {
  // Claude web API uses /api/ prefix for all endpoints
  registerProvider('/api/', claudeWebProvider);
}
