import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRateLimiterPlugin, type RateLimiterConfig } from '../../../src/plugins/builtin/rate-limiter.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import type { RequestContext, ResponseCompleteContext } from '../../../src/plugins/types.js';

function makeConfig(overrides: Partial<RateLimiterConfig> = {}): RateLimiterConfig {
  return {
    enabled: true,
    requestsPerMinute: 0,
    tokensPerHour: 0,
    maxCostPerHour: 0,
    maxCostPerDay: 0,
    maxCostPerMonth: 0,
    action: 'block',
    warningThreshold: 0.8,
    ...overrides,
  };
}

function makeRequestContext(): RequestContext {
  return {
    id: crypto.randomUUID(),
    provider: 'anthropic',
    model: 'claude-haiku-4.5-20241022',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: '{}',
    parsedBody: {},
    isStreaming: false,
    startTime: Date.now(),
  } as RequestContext;
}

function makeResponseContext(overrides: Partial<ResponseCompleteContext> = {}): ResponseCompleteContext {
  return {
    request: makeRequestContext(),
    statusCode: 200,
    body: '{}',
    parsedBody: {},
    usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    latencyMs: 200,
    isStreaming: false,
    ...overrides,
  };
}

describe('Rate Limiter Plugin', () => {
  let db: ReturnType<typeof createTestDatabase>;
  let eventBus: PluginEventBus;

  afterEach(() => {
    if (db) db.close();
  });

  function createPlugin(cfgOverrides: Partial<RateLimiterConfig> = {}) {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const cfg = makeConfig(cfgOverrides);
    return createRateLimiterPlugin(db, () => cfg, eventBus);
  }

  // --- RPM blocking ---
  describe('RPM blocking', () => {
    it('blocks the request that exceeds requestsPerMinute', async () => {
      const plugin = createPlugin({ requestsPerMinute: 3 });

      // First 3 requests should pass
      for (let i = 0; i < 3; i++) {
        const result = await plugin.onRequest!(makeRequestContext());
        expect(result?.blocked).toBeUndefined();
      }

      // 4th request should be blocked
      const result = await plugin.onRequest!(makeRequestContext());
      expect(result).toBeDefined();
      expect(result!.blocked).toBeDefined();
      expect(result!.blocked!.reason).toContain('requests per minute');
    });

    it('emits rate-limit:exceeded event on RPM block', async () => {
      const plugin = createPlugin({ requestsPerMinute: 1 });
      const events: unknown[] = [];
      eventBus.on('rate-limit:exceeded', (data) => events.push(data));

      await plugin.onRequest!(makeRequestContext()); // passes
      await plugin.onRequest!(makeRequestContext()); // blocked

      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).type).toBe('requestsPerMinute');
    });

    it('increments recentBlocks counter', async () => {
      const plugin = createPlugin({ requestsPerMinute: 1 }) as ReturnType<typeof createRateLimiterPlugin> & { getState: () => unknown };
      await plugin.onRequest!(makeRequestContext());
      await plugin.onRequest!(makeRequestContext()); // blocked

      const state = (plugin as any).getState();
      expect(state.recentBlocks).toBe(1);
    });
  });

  // --- Budget exceeded ---
  describe('budget exceeded', () => {
    it('blocks when maxCostPerDay is exceeded', async () => {
      const plugin = createPlugin({ maxCostPerDay: 0.001 });

      // Simulate a completed response that accumulates cost
      const respCtx = makeResponseContext({
        request: {
          ...makeRequestContext(),
          model: 'claude-haiku-4.5-20241022',
        } as RequestContext,
        usage: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await plugin.onResponseComplete!(respCtx);

      // Next request should be blocked (cost accumulated exceeds $0.001)
      const result = await plugin.onRequest!(makeRequestContext());
      expect(result).toBeDefined();
      expect(result!.blocked).toBeDefined();
      expect(result!.blocked!.reason).toContain('per day');
    });

    it('blocks when maxCostPerHour is exceeded', async () => {
      const plugin = createPlugin({ maxCostPerHour: 0.001 });

      const respCtx = makeResponseContext({
        usage: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await plugin.onResponseComplete!(respCtx);

      const result = await plugin.onRequest!(makeRequestContext());
      expect(result).toBeDefined();
      expect(result!.blocked).toBeDefined();
      expect(result!.blocked!.reason).toContain('per hour');
    });

    it('blocks when maxCostPerMonth is exceeded', async () => {
      const plugin = createPlugin({ maxCostPerMonth: 0.001 });

      const respCtx = makeResponseContext({
        usage: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await plugin.onResponseComplete!(respCtx);

      const result = await plugin.onRequest!(makeRequestContext());
      expect(result).toBeDefined();
      expect(result!.blocked).toBeDefined();
      expect(result!.blocked!.reason).toContain('per month');
    });

    it('blocks when tokensPerHour is exceeded', async () => {
      const plugin = createPlugin({ tokensPerHour: 100 });

      const respCtx = makeResponseContext({
        usage: { inputTokens: 80, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await plugin.onResponseComplete!(respCtx);

      const result = await plugin.onRequest!(makeRequestContext());
      expect(result).toBeDefined();
      expect(result!.blocked).toBeDefined();
      expect(result!.blocked!.reason).toContain('tokens per hour');
    });
  });

  // --- Warn mode ---
  describe('warn mode', () => {
    it('allows request through when action is warn', async () => {
      const plugin = createPlugin({ requestsPerMinute: 1, action: 'warn' });
      const events: unknown[] = [];
      eventBus.on('rate-limit:exceeded', (data) => events.push(data));

      await plugin.onRequest!(makeRequestContext()); // passes
      const result = await plugin.onRequest!(makeRequestContext()); // exceeds but warn mode

      // Should not block
      expect(result?.blocked).toBeUndefined();
      // Should still emit event
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).action).toBe('warn');
    });

    it('allows cost-exceeded request through in warn mode', async () => {
      const plugin = createPlugin({ maxCostPerDay: 0.001, action: 'warn' });

      const respCtx = makeResponseContext({
        usage: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await plugin.onResponseComplete!(respCtx);

      const result = await plugin.onRequest!(makeRequestContext());
      expect(result?.blocked).toBeUndefined();
    });
  });

  // --- Warning threshold ---
  describe('warning threshold', () => {
    it('emits rate-limit:warning when approaching limit', async () => {
      const plugin = createPlugin({ requestsPerMinute: 5, warningThreshold: 0.6 });
      const warnings: unknown[] = [];
      eventBus.on('rate-limit:warning', (data) => warnings.push(data));

      // Send 3 requests (60% of 5 = at threshold)
      for (let i = 0; i < 3; i++) {
        await plugin.onRequest!(makeRequestContext());
      }

      // 4th request: 3/5 = 0.6 which is >= warningThreshold but < 1.0
      await plugin.onRequest!(makeRequestContext());

      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect((warnings[0] as Record<string, unknown>).type).toBe('requestsPerMinute');
    });
  });

  // --- Period rollover ---
  describe('period rollover', () => {
    it('resets hourly counters when hour changes', async () => {
      const plugin = createPlugin({ maxCostPerHour: 0.001 });

      // Accumulate cost
      const respCtx = makeResponseContext({
        usage: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await plugin.onResponseComplete!(respCtx);

      // Verify blocked
      let result = await plugin.onRequest!(makeRequestContext());
      expect(result?.blocked).toBeDefined();

      // Advance time past the next hour boundary
      const now = Date.now();
      const nextHour = new Date(now);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      vi.useFakeTimers({ now: nextHour.getTime() + 1000 });

      // After hour rollover, request should pass
      result = await plugin.onRequest!(makeRequestContext());
      expect(result?.blocked).toBeUndefined();

      vi.useRealTimers();
    });

    it('resets daily counters when day changes', async () => {
      const plugin = createPlugin({ maxCostPerDay: 0.001 });

      const respCtx = makeResponseContext({
        usage: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await plugin.onResponseComplete!(respCtx);

      // Verify blocked
      let result = await plugin.onRequest!(makeRequestContext());
      expect(result?.blocked).toBeDefined();

      // Advance to next day
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 1, 0, 0);
      vi.useFakeTimers({ now: tomorrow.getTime() });

      result = await plugin.onRequest!(makeRequestContext());
      expect(result?.blocked).toBeUndefined();

      vi.useRealTimers();
    });
  });

  // --- DB recovery ---
  describe('DB recovery on startup', () => {
    it('recovers cost counters from requests table', () => {
      db = createTestDatabase();
      eventBus = new PluginEventBus();

      // Insert a request record within the current hour
      const now = new Date();
      const createdAt = now.toISOString();
      db.prepare(
        `INSERT INTO requests (id, provider, model, method, path, status_code, input_tokens, output_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(), 'anthropic', 'claude-haiku-4.5-20241022', 'POST', '/v1/messages',
        200, 1000, 500, 0.05, createdAt,
      );

      // Create plugin — it should recover counters from DB
      const cfg = makeConfig({ maxCostPerDay: 0.01 });
      const plugin = createRateLimiterPlugin(db, () => cfg, eventBus);

      // The state should reflect the recovered cost
      const state = (plugin as any).getState();
      expect(state.limits.maxCostPerDay).toBeDefined();
      expect(state.limits.maxCostPerDay.current).toBeCloseTo(0.05, 4);
    });

    it('recovers token counters from requests table', () => {
      db = createTestDatabase();
      eventBus = new PluginEventBus();

      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO requests (id, provider, model, method, path, status_code, input_tokens, output_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(), 'anthropic', 'claude-haiku-4.5-20241022', 'POST', '/v1/messages',
        200, 1000, 500, 0.01, createdAt,
      );

      const cfg = makeConfig({ tokensPerHour: 10000 });
      const plugin = createRateLimiterPlugin(db, () => cfg, eventBus);

      const state = (plugin as any).getState();
      expect(state.limits.tokensPerHour).toBeDefined();
      expect(state.limits.tokensPerHour.current).toBe(1500); // 1000 + 500
    });

    it('does not recover records from previous periods', () => {
      db = createTestDatabase();
      eventBus = new PluginEventBus();

      // Insert a request from yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);
      db.prepare(
        `INSERT INTO requests (id, provider, model, method, path, status_code, input_tokens, output_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(), 'anthropic', 'claude-haiku-4.5-20241022', 'POST', '/v1/messages',
        200, 1000, 500, 0.50, yesterday.toISOString(),
      );

      // maxCostPerHour — yesterday's data should not count for hourly counter
      const cfg = makeConfig({ maxCostPerHour: 1.0 });
      const plugin = createRateLimiterPlugin(db, () => cfg, eventBus);

      const state = (plugin as any).getState();
      expect(state.limits.maxCostPerHour.current).toBe(0);
    });
  });

  // --- getState ---
  describe('getState', () => {
    it('returns correct state with active limits', async () => {
      const plugin = createPlugin({
        requestsPerMinute: 60,
        maxCostPerDay: 10,
        maxCostPerMonth: 100,
      });

      const state = (plugin as any).getState();
      expect(state.action).toBe('block');
      expect(state.recentBlocks).toBe(0);
      expect(state.limits.requestsPerMinute).toBeDefined();
      expect(state.limits.maxCostPerDay).toBeDefined();
      expect(state.limits.maxCostPerMonth).toBeDefined();
      // tokensPerHour not set (0), should be absent
      expect(state.limits.tokensPerHour).toBeUndefined();
    });

    it('omits limits that are set to 0', () => {
      const plugin = createPlugin(); // all defaults = 0

      const state = (plugin as any).getState();
      expect(Object.keys(state.limits)).toHaveLength(0);
    });
  });

  // --- onResponseComplete accumulates counters ---
  describe('onResponseComplete', () => {
    it('accumulates tokens and cost from response', async () => {
      const plugin = createPlugin({ tokensPerHour: 10000, maxCostPerDay: 100 });

      await plugin.onResponseComplete!(makeResponseContext({
        usage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 },
      }));

      const state = (plugin as any).getState();
      expect(state.limits.tokensPerHour.current).toBeGreaterThan(0);
    });
  });
});
