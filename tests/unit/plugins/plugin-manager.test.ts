import { describe, it, expect } from 'vitest';
import { PluginManager } from '../../../src/plugins/index.js';
import type { Plugin, RequestContext, ResponseCompleteContext } from '../../../src/plugins/types.js';

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    id: 'test-req',
    provider: 'anthropic',
    model: 'claude-haiku-4.5-20241022',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: '{}',
    parsedBody: {},
    isStreaming: false,
    startTime: Date.now(),
    ...overrides,
  };
}

function makeResponseContext(overrides: Partial<ResponseCompleteContext> = {}): ResponseCompleteContext {
  return {
    request: makeContext(),
    statusCode: 200,
    body: '{}',
    parsedBody: {},
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    latencyMs: 500,
    isStreaming: false,
    ...overrides,
  };
}

describe('PluginManager', () => {
  it('runs plugins in priority order', async () => {
    const order: string[] = [];
    const pm = new PluginManager(1000);

    const pluginA: Plugin = {
      name: 'a',
      priority: 20,
      async onRequest() { order.push('a'); },
    };
    const pluginB: Plugin = {
      name: 'b',
      priority: 10,
      async onRequest() { order.push('b'); },
    };

    pm.register(pluginA);
    pm.register(pluginB);

    await pm.runOnRequest(makeContext());
    expect(order).toEqual(['b', 'a']); // b has lower priority number, runs first
  });

  it('short-circuits on cache hit', async () => {
    const pm = new PluginManager(1000);
    let secondRan = false;

    pm.register({
      name: 'cache',
      priority: 10,
      async onRequest() {
        return {
          shortCircuit: {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: '{"cached":true}',
          },
        };
      },
    });

    pm.register({
      name: 'second',
      priority: 20,
      async onRequest() { secondRan = true; },
    });

    const result = await pm.runOnRequest(makeContext());
    expect(result.shortCircuit).toBeDefined();
    expect(secondRan).toBe(false);
  });

  it('blocks request when plugin returns blocked', async () => {
    const pm = new PluginManager(1000);

    pm.register({
      name: 'dlp',
      priority: 10,
      async onRequest() {
        return { blocked: { reason: 'PII detected' } };
      },
    });

    const result = await pm.runOnRequest(makeContext());
    expect(result.blocked).toBeDefined();
    expect(result.blocked!.reason).toBe('PII detected');
  });

  it('skips timed-out plugins (fail-open)', async () => {
    const pm = new PluginManager(10); // 10ms timeout
    let secondRan = false;

    pm.register({
      name: 'slow',
      priority: 10,
      async onRequest() {
        await new Promise((r) => setTimeout(r, 5000));
      },
    });

    pm.register({
      name: 'fast',
      priority: 20,
      async onRequest() { secondRan = true; },
    });

    await pm.runOnRequest(makeContext());
    expect(secondRan).toBe(true);
  });

  it('skips erroring plugins (fail-open)', async () => {
    const pm = new PluginManager(1000);
    let secondRan = false;

    pm.register({
      name: 'broken',
      priority: 10,
      async onRequest() { throw new Error('plugin crashed'); },
    });

    pm.register({
      name: 'working',
      priority: 20,
      async onRequest() { secondRan = true; },
    });

    await pm.runOnRequest(makeContext());
    expect(secondRan).toBe(true);
  });

  it('runs onResponseComplete for all plugins', async () => {
    const order: string[] = [];
    const pm = new PluginManager(1000);

    pm.register({
      name: 'metrics',
      priority: 10,
      async onResponseComplete() { order.push('metrics'); },
    });

    pm.register({
      name: 'logger',
      priority: 20,
      async onResponseComplete() { order.push('logger'); },
    });

    await pm.runOnResponseComplete(makeResponseContext());
    expect(order).toEqual(['metrics', 'logger']);
  });

  it('passes modified body between plugins', async () => {
    const pm = new PluginManager(1000);

    pm.register({
      name: 'trimmer',
      priority: 10,
      async onRequest(ctx) {
        return { modifiedBody: ctx.body.replace(/\s+/g, ' ') };
      },
    });

    let receivedBody = '';
    pm.register({
      name: 'inspector',
      priority: 20,
      async onRequest(ctx) {
        receivedBody = ctx.body;
      },
    });

    await pm.runOnRequest(makeContext({ body: 'hello   world' }));
    expect(receivedBody).toBe('hello world');
  });
});
