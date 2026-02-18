import { describe, it, expect, beforeEach } from 'vitest';
import { resolveRoute } from '../../../src/proxy/router.js';
import { clearProviders } from '../../../src/proxy/providers/index.js';
import { registerAnthropicProvider } from '../../../src/proxy/providers/anthropic.js';
import { registerOpenAIProvider } from '../../../src/proxy/providers/openai.js';
import { registerGeminiProvider } from '../../../src/proxy/providers/gemini.js';
import type { IncomingMessage } from 'node:http';

function mockReq(url: string, method = 'POST'): IncomingMessage {
  return { url, method } as IncomingMessage;
}

describe('Router', () => {
  beforeEach(() => {
    clearProviders();
    registerAnthropicProvider();
    registerOpenAIProvider();
    registerGeminiProvider();
  });

  it('routes /v1/messages to Anthropic', () => {
    const result = resolveRoute(mockReq('/v1/messages'));
    expect(result).not.toBeNull();
    expect(result!.provider.name).toBe('anthropic');
    expect(result!.upstreamUrl).toBe('https://api.anthropic.com/v1/messages');
  });

  it('routes /v1/chat/completions to OpenAI', () => {
    const result = resolveRoute(mockReq('/v1/chat/completions'));
    expect(result).not.toBeNull();
    expect(result!.provider.name).toBe('openai');
    expect(result!.upstreamUrl).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('routes /v1/responses to OpenAI', () => {
    const result = resolveRoute(mockReq('/v1/responses'));
    expect(result).not.toBeNull();
    expect(result!.provider.name).toBe('openai');
  });

  it('routes /v1beta/models/gemini-pro:generateContent to Gemini', () => {
    const result = resolveRoute(mockReq('/v1beta/models/gemini-pro:generateContent'));
    expect(result).not.toBeNull();
    expect(result!.provider.name).toBe('gemini');
    expect(result!.upstreamUrl).toContain('generativelanguage.googleapis.com');
  });

  it('returns null for unknown paths', () => {
    const result = resolveRoute(mockReq('/unknown/path'));
    expect(result).toBeNull();
  });
});
