import { describe, it, expect } from 'vitest';
import { anthropicProvider } from '../../../src/proxy/providers/anthropic.js';
import { openaiProvider } from '../../../src/proxy/providers/openai.js';
import { geminiProvider } from '../../../src/proxy/providers/gemini.js';

describe('Anthropic Provider', () => {
  it('extracts model from body', () => {
    expect(anthropicProvider.extractModel({ model: 'claude-haiku-4.5-20241022' })).toBe('claude-haiku-4.5-20241022');
  });

  it('extracts usage from response', () => {
    const usage = anthropicProvider.extractUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 20,
      },
    });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.cacheCreationTokens).toBe(10);
    expect(usage.cacheReadTokens).toBe(20);
  });

  it('transforms headers correctly', () => {
    const headers = anthropicProvider.transformHeaders({
      'x-api-key': 'sk-test',
      'anthropic-version': '2024-01-01',
      'content-type': 'application/json',
      'host': 'localhost:8420',
      'user-agent': 'test',
    });
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2024-01-01');
    expect(headers['host']).toBeUndefined();
    expect(headers['user-agent']).toBeUndefined();
  });
});

describe('OpenAI Provider', () => {
  it('extracts model from body', () => {
    expect(openaiProvider.extractModel({ model: 'gpt-4o' })).toBe('gpt-4o');
  });

  it('extracts usage from response', () => {
    const usage = openaiProvider.extractUsage({
      usage: { prompt_tokens: 200, completion_tokens: 100 },
    });
    expect(usage.inputTokens).toBe(200);
    expect(usage.outputTokens).toBe(100);
  });

  it('transforms headers with authorization', () => {
    const headers = openaiProvider.transformHeaders({
      'authorization': 'Bearer sk-test',
      'content-type': 'application/json',
      'host': 'localhost',
    });
    expect(headers['authorization']).toBe('Bearer sk-test');
    expect(headers['host']).toBeUndefined();
  });
});

describe('Gemini Provider', () => {
  it('extracts usage from response', () => {
    const usage = geminiProvider.extractUsage({
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 75 },
    });
    expect(usage.inputTokens).toBe(150);
    expect(usage.outputTokens).toBe(75);
  });
});
