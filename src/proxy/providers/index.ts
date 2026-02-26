export interface ProviderConfig {
  name: string;
  baseUrl: string;
  /** Header name that carries the API key */
  authHeader: string;
  /** Transform outgoing headers (e.g., rename auth header) */
  transformHeaders(headers: Record<string, string>): Record<string, string>;
  /** Extract model name from parsed request body */
  extractModel(body: Record<string, unknown>): string;
  /** Extract usage from non-streaming response body */
  extractUsage(body: Record<string, unknown>): {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
}

const MESSAGING_NAMES = new Set(['telegram', 'discord', 'slack', 'whatsapp', 'line']);

const providers = new Map<string, ProviderConfig>();

export function registerProvider(pathPrefix: string, provider: ProviderConfig): void {
  providers.set(pathPrefix, provider);
}

export function getProvider(path: string, opts?: { excludeMessaging?: boolean }): { provider: ProviderConfig; pathPrefix: string } | undefined {
  // Match longest prefix first
  let bestMatch: { provider: ProviderConfig; pathPrefix: string } | undefined;
  let bestLen = 0;

  for (const [prefix, provider] of providers) {
    if (opts?.excludeMessaging && MESSAGING_NAMES.has(provider.name)) continue;
    if (path.startsWith(prefix) && prefix.length > bestLen) {
      bestMatch = { provider, pathPrefix: prefix };
      bestLen = prefix.length;
    }
  }

  return bestMatch;
}

export function getAllProviders(): Map<string, ProviderConfig> {
  return providers;
}

export function clearProviders(): void {
  providers.clear();
}
