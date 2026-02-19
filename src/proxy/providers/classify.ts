/**
 * Provider classification utilities.
 * Used by plugins to decide how to handle different provider types.
 */

const LLM_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'claude-web']);

const MESSAGING_PROVIDERS = new Set(['telegram', 'discord', 'slack', 'whatsapp', 'line']);

// Messaging polling endpoints — high frequency, low audit value
const POLLING_PATTERNS = [
  '/getUpdates',        // Telegram long polling
  '/gateway',           // Discord gateway
  '/rtm.connect',       // Slack RTM
  '/getMe',             // Telegram bot info
  '/getWebhookInfo',    // Telegram webhook check
];

/** True for LLM API providers (Anthropic, OpenAI, Gemini, Claude Web) */
export function isLLMProvider(provider: string): boolean {
  return LLM_PROVIDERS.has(provider);
}

/** True for messaging platforms (Telegram, Discord, Slack, etc.) */
export function isMessagingProvider(provider: string): boolean {
  return MESSAGING_PROVIDERS.has(provider);
}

/**
 * True for high-frequency polling requests that should skip metrics/audit.
 * Actual message sends (sendMessage, chat.postMessage, etc.) return false.
 */
export function isPollingRequest(provider: string, path: string): boolean {
  if (!MESSAGING_PROVIDERS.has(provider)) return false;
  return POLLING_PATTERNS.some((p) => path.includes(p));
}
