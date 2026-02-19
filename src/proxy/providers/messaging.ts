import { registerProvider, type ProviderConfig } from './index.js';

/**
 * Generic messaging platform provider — for DLP scanning of messages
 * sent/received via Telegram, Discord, Slack, WhatsApp, LINE, etc.
 */
function createMessagingProvider(name: string, baseUrl: string): ProviderConfig {
  return {
    name,
    baseUrl,
    authHeader: '',
    transformHeaders(headers: Record<string, string>): Record<string, string> {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (
          lower === 'content-type' ||
          lower === 'accept' ||
          lower === 'user-agent' ||
          lower === 'authorization' ||
          lower === 'cookie'
        ) {
          result[key] = value;
        }
      }
      return result;
    },
    extractModel(): string {
      return name;
    },
    extractUsage(): { inputTokens: number; outputTokens: number } {
      return { inputTokens: 0, outputTokens: 0 };
    },
  };
}

export function registerMessagingProviders(): void {
  // Telegram Bot API: /bot<token>/<method>
  const telegram = createMessagingProvider('telegram', 'https://api.telegram.org');
  registerProvider('/bot', telegram);

  // Discord: /api/v10/channels/... etc
  const discord = createMessagingProvider('discord', 'https://discord.com');
  registerProvider('/api/v', discord);

  // Slack: /api/chat.postMessage etc
  const slack = createMessagingProvider('slack', 'https://api.slack.com');
  registerProvider('/api/', slack);

  // WhatsApp Business API via Meta Graph: /v*/...
  const whatsapp = createMessagingProvider('whatsapp', 'https://graph.facebook.com');
  registerProvider('/v', whatsapp);

  // LINE Messaging API: /v2/bot/message/...
  const line = createMessagingProvider('line', 'https://api.line.me');
  registerProvider('/v2/', line);
}
