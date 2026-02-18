import { describe, it, expect, afterEach } from 'vitest';
import { createMetricsCollectorPlugin } from '../../../src/plugins/builtin/metrics-collector.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import { RequestsRepository } from '../../../src/storage/repositories/requests.js';
import type { ResponseCompleteContext, RequestContext } from '../../../src/plugins/types.js';

function makeResponseContext(overrides: Partial<ResponseCompleteContext> = {}): ResponseCompleteContext {
  return {
    request: {
      id: crypto.randomUUID(),
      provider: 'anthropic',
      model: 'claude-haiku-4.5-20241022',
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: '{}',
      parsedBody: {},
      isStreaming: false,
      startTime: Date.now() - 500,
    } as RequestContext,
    statusCode: 200,
    body: '{}',
    parsedBody: {},
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    latencyMs: 500,
    isStreaming: false,
    ...overrides,
  };
}

describe('Metrics Collector Plugin', () => {
  let db: ReturnType<typeof createTestDatabase>;

  afterEach(() => {
    if (db) db.close();
  });

  it('records request metrics to database', async () => {
    db = createTestDatabase();
    const plugin = createMetricsCollectorPlugin(db);
    const ctx = makeResponseContext();

    await plugin.onResponseComplete!(ctx);

    const repo = new RequestsRepository(db);
    const recent = repo.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].provider).toBe('anthropic');
    expect(recent[0].input_tokens).toBe(100);
    expect(recent[0].output_tokens).toBe(50);
  });

  it('calculates cost for known models', async () => {
    db = createTestDatabase();
    const plugin = createMetricsCollectorPlugin(db);
    const ctx = makeResponseContext({
      usage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    await plugin.onResponseComplete!(ctx);

    const repo = new RequestsRepository(db);
    const recent = repo.getRecent(1);
    expect(recent[0].cost_usd).toBeGreaterThan(0);
  });
});
