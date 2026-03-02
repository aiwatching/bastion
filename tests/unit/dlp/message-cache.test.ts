import { describe, it, expect, beforeEach } from 'vitest';
import { DlpMessageCache } from '../../../src/dlp/message-cache.js';
import { getPatterns } from '../../../src/dlp/engine.js';

const patterns = getPatterns(['high-confidence', 'validated', 'context-aware']);

function makeBody(messages: Array<{ role: string; content: string }>, system?: string) {
  const obj: Record<string, unknown> = { model: 'claude-sonnet-4-20250514', messages };
  if (system) obj.system = system;
  return {
    body: JSON.stringify(obj),
    parsedBody: obj,
  };
}

describe('DlpMessageCache', () => {
  let cache: DlpMessageCache;

  beforeEach(() => {
    cache = new DlpMessageCache();
  });

  it('scans all messages on first request', () => {
    const { body, parsedBody } = makeBody([
      { role: 'user', content: 'hello world' },
    ]);

    const result = cache.scanWithCache(body, parsedBody, patterns, 'warn');

    expect(result.action).toBe('pass');
    expect(result.findings).toHaveLength(0);
    expect(cache.stats.misses).toBe(1);
    expect(cache.stats.hits).toBe(0);
  });

  it('cache hits on repeated messages', () => {
    const msg1 = { role: 'user', content: 'hello world' };
    const msg2 = { role: 'assistant', content: 'hi there' };

    // Turn 1: 1 message
    const t1 = makeBody([msg1]);
    cache.scanWithCache(t1.body, t1.parsedBody, patterns, 'warn');
    expect(cache.stats).toMatchObject({ hits: 0, misses: 1 });

    // Turn 2: same message + 2 new ones
    const msg3 = { role: 'user', content: 'what is the weather?' };
    const t2 = makeBody([msg1, msg2, msg3]);
    cache.scanWithCache(t2.body, t2.parsedBody, patterns, 'warn');

    // msg1 = cache hit, msg2 + msg3 = misses
    expect(cache.stats).toMatchObject({ hits: 1, misses: 3 });
  });

  it('detects sensitive data in new messages only', () => {
    const safe = { role: 'user', content: 'hello world' };
    const sensitive = { role: 'user', content: 'My AWS access key is AKIAI44QH8DHBF3KP2XY' };

    // Turn 1: safe message
    const t1 = makeBody([safe]);
    const r1 = cache.scanWithCache(t1.body, t1.parsedBody, patterns, 'warn');
    expect(r1.findings).toHaveLength(0);

    // Turn 2: add sensitive message
    const t2 = makeBody([safe, { role: 'assistant', content: 'ok' }, sensitive]);
    const r2 = cache.scanWithCache(t2.body, t2.parsedBody, patterns, 'warn');
    expect(r2.findings.length).toBeGreaterThan(0);
    expect(r2.findings.some((f) => f.patternName === 'aws-access-key')).toBe(true);

    // safe was cache hit, only new messages scanned
    expect(cache.stats.hits).toBe(1);
  });

  it('returns cached findings for previously detected messages', () => {
    const sensitive = { role: 'user', content: 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' };

    // Turn 1: sensitive message detected
    const t1 = makeBody([sensitive]);
    const r1 = cache.scanWithCache(t1.body, t1.parsedBody, patterns, 'warn');
    expect(r1.findings.length).toBeGreaterThan(0);

    // Turn 2: same message repeated — findings from cache
    const t2 = makeBody([sensitive, { role: 'assistant', content: 'noted' }]);
    const r2 = cache.scanWithCache(t2.body, t2.parsedBody, patterns, 'warn');
    expect(r2.findings.length).toBeGreaterThan(0);
    expect(cache.stats.hits).toBe(1);
  });

  it('handles redaction using findings from cache', () => {
    const secret = 'AKIAI44QH8DHBF3KP2XY';
    const sensitive = { role: 'user', content: `My AWS access key is ${secret}` };
    const safe = { role: 'assistant', content: 'got it' };

    // Turn 1: detect
    const t1 = makeBody([sensitive]);
    cache.scanWithCache(t1.body, t1.parsedBody, patterns, 'warn');

    // Turn 2: redact mode — cached finding applied to full body
    const t2 = makeBody([sensitive, safe]);
    const r2 = cache.scanWithCache(t2.body, t2.parsedBody, patterns, 'redact');
    expect(r2.redactedBody).toBeDefined();
    expect(r2.redactedBody).not.toContain(secret);
    expect(r2.redactedBody).toContain('_REDACTED]');
  });

  it('falls back to full scan for non-messages format', () => {
    const body = JSON.stringify({ prompt: 'hello world' });
    const parsedBody = { prompt: 'hello world' };

    const result = cache.scanWithCache(body, parsedBody, patterns, 'warn');
    expect(result.action).toBe('pass');
    // No messages array → no cache interaction
    expect(cache.stats.hits).toBe(0);
    expect(cache.stats.misses).toBe(0);
  });

  it('scans system prompt with caching', () => {
    const system = 'You are a helpful assistant';
    const t1 = makeBody([{ role: 'user', content: 'hi' }], system);
    cache.scanWithCache(t1.body, t1.parsedBody, patterns, 'warn');
    expect(cache.stats.misses).toBe(2); // system + 1 message

    // Turn 2: system cached
    const t2 = makeBody([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how are you?' },
    ], system);
    cache.scanWithCache(t2.body, t2.parsedBody, patterns, 'warn');

    // system + "hi" = 2 cache hits; "hello" + "how are you?" = 2 misses
    expect(cache.stats.hits).toBe(2);
    expect(cache.stats.misses).toBe(4);
  });

  it('multi-agent: different conversations share cache', () => {
    // Agent A and B happen to share a common system prompt
    const system = 'You are a coding assistant';

    const agentA = makeBody([{ role: 'user', content: 'write a function' }], system);
    cache.scanWithCache(agentA.body, agentA.parsedBody, patterns, 'warn');
    expect(cache.stats.misses).toBe(2);

    const agentB = makeBody([{ role: 'user', content: 'fix this bug' }], system);
    cache.scanWithCache(agentB.body, agentB.parsedBody, patterns, 'warn');

    // system = cache hit, "fix this bug" = miss
    expect(cache.stats.hits).toBe(1);
    expect(cache.stats.misses).toBe(3);
  });

  it('handles multimodal content blocks', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'Check this AWS access key: AKIAI44QH8DHBF3KP2XY' },
        { type: 'image', source: { data: 'base64...' } },
      ],
    };
    const obj = { model: 'test', messages: [msg] };
    const body = JSON.stringify(obj);

    const result = cache.scanWithCache(body, obj, patterns, 'warn');
    expect(result.findings.some((f) => f.patternName === 'aws-access-key')).toBe(true);
  });

  it('simulates 10-turn conversation efficiency', () => {
    const turns: Array<{ role: string; content: string }>[] = [];
    const messages: Array<{ role: string; content: string }> = [];

    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: `User message ${i}: ${Date.now()}` });
      messages.push({ role: 'assistant', content: `Assistant reply ${i}: ${Date.now()}` });
      turns.push([...messages]);
    }

    let totalHits = 0;
    let totalMisses = 0;

    for (const turn of turns) {
      cache = new DlpMessageCache(); // fresh cache per test
      // Re-simulate all previous turns to build cache
      // Actually: accumulate within same cache
    }

    // Better: single cache, simulate sequential turns
    cache = new DlpMessageCache();
    for (let i = 0; i < turns.length; i++) {
      const { body, parsedBody } = makeBody(turns[i]);
      cache.scanWithCache(body, parsedBody, patterns, 'warn');
    }

    const stats = cache.stats;
    // Turn 1: 2 misses. Turn 2: 2 hits + 2 misses. Turn 3: 4 hits + 2 misses. ...
    // Total misses = 2 * 10 = 20 (each turn adds 2 new messages)
    // Total hits   = 0 + 2 + 4 + 6 + ... + 18 = 90
    expect(stats.misses).toBe(20);
    expect(stats.hits).toBe(90);
    // Without cache, would have scanned 2+4+6+...+20 = 110 messages
    // With cache, scanned only 20 new messages — 82% reduction
  });
});
