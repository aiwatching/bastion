import { registerProvider, type ProviderConfig } from './index.js';

/**
 * ChatGPT Web / Codex provider — for tools that use chatgpt.com backend API
 * (e.g., OpenAI Codex CLI uses chatgpt.com/backend-api/codex/responses)
 */
export const chatgptProvider: ProviderConfig = {
  name: 'chatgpt',
  baseUrl: 'https://chatgpt.com',
  authHeader: 'authorization',
  transformHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      // Pass through auth, content, and OpenAI-specific headers.
      // Strip accept-encoding so upstream responds uncompressed — bastion
      // needs plain-text SSE to parse events for metrics/audit.
      if (lower !== 'host' && lower !== 'connection' && lower !== 'transfer-encoding' && lower !== 'accept-encoding') {
        result[key] = value;
      }
    }
    return result;
  },
  extractModel(body: Record<string, unknown>): string {
    return (body.model as string) ?? 'codex';
  },
  extractUsage(body: Record<string, unknown>): {
    inputTokens: number;
    outputTokens: number;
  } {
    const usage = body.usage as Record<string, number> | undefined;
    if (!usage) return { inputTokens: 0, outputTokens: 0 };
    return {
      inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    };
  },
};

export function registerChatGPTProvider(): void {
  registerProvider('/backend-api/', chatgptProvider);
}
