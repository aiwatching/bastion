import { describe, it, expect, afterEach } from 'vitest';
import { toProxyRequest, toProxyResponseFromIntercept, toProxyResponseFromComplete, adaptPlugin } from '../../../src/plugins/adapter.js';
import { PluginEventsRepository } from '../../../src/storage/repositories/plugin-events.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import type { RequestContext, ResponseInterceptContext, ResponseCompleteContext } from '../../../src/plugins/types.js';
import type { BastionPlugin, PluginResult } from '../../../src/plugin-api/index.js';
import { PLUGIN_API_VERSION } from '../../../src/plugin-api/index.js';
import type Database from 'better-sqlite3';

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    id: 'req-1',
    provider: 'anthropic',
    model: 'claude-haiku-4.5-20241022',
    method: 'POST',
    path: '/v1/messages',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    parsedBody: { messages: [] },
    isStreaming: false,
    startTime: Date.now(),
    apiKeyHash: 'abc123',
    sessionSource: 'auto',
    dlpHit: true,
    dlpAction: 'warn',
    dlpFindings: 2,
    toolGuardHit: true,
    _toolGuardRecorded: true,
    _toolGuardStreamBlock: 'critical',
    ...overrides,
  };
}

describe('adapter', () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  describe('toProxyRequest', () => {
    it('strips internal flags and freezes headers/parsedBody', () => {
      const ctx = makeContext();
      const req = toProxyRequest(ctx);

      // Public fields present
      expect(req.id).toBe('req-1');
      expect(req.provider).toBe('anthropic');
      expect(req.sessionId).toBeUndefined();

      // Internal flags stripped
      expect((req as Record<string, unknown>).startTime).toBeUndefined();
      expect((req as Record<string, unknown>).apiKeyHash).toBeUndefined();
      expect((req as Record<string, unknown>).sessionSource).toBeUndefined();
      expect((req as Record<string, unknown>).dlpHit).toBeUndefined();
      expect((req as Record<string, unknown>).dlpAction).toBeUndefined();
      expect((req as Record<string, unknown>).dlpFindings).toBeUndefined();
      expect((req as Record<string, unknown>).toolGuardHit).toBeUndefined();
      expect((req as Record<string, unknown>)._toolGuardRecorded).toBeUndefined();
      expect((req as Record<string, unknown>)._toolGuardStreamBlock).toBeUndefined();

      // Frozen
      expect(Object.isFrozen(req.headers)).toBe(true);
      expect(Object.isFrozen(req.parsedBody)).toBe(true);
    });
  });

  describe('toProxyResponseFromIntercept', () => {
    it('converts ResponseInterceptContext without usage/latency', () => {
      const ctx: ResponseInterceptContext = {
        request: makeContext(),
        statusCode: 200,
        headers: { 'x-test': '1' },
        body: '{"ok":true}',
        parsedBody: { ok: true },
        isStreaming: false,
      };
      const res = toProxyResponseFromIntercept(ctx);

      expect(res.statusCode).toBe(200);
      expect(res.usage).toBeUndefined();
      expect(res.latencyMs).toBeUndefined();
      expect(Object.isFrozen(res.headers)).toBe(true);
      // Internal flags on request are stripped
      expect((res.request as Record<string, unknown>).dlpHit).toBeUndefined();
    });
  });

  describe('toProxyResponseFromComplete', () => {
    it('includes usage (stripped of cache tokens) and latencyMs', () => {
      const ctx: ResponseCompleteContext = {
        request: makeContext(),
        statusCode: 200,
        body: '{}',
        parsedBody: {},
        usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
        latencyMs: 500,
        isStreaming: false,
        sseEvents: [{ type: 'message_start' }],
      };
      const res = toProxyResponseFromComplete(ctx);

      expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(res.latencyMs).toBe(500);
      // sseEvents not exposed
      expect((res as Record<string, unknown>).sseEvents).toBeUndefined();
    });
  });

  describe('adaptPlugin', () => {
    it('bridges onRequest pass-through', async () => {
      db = createTestDatabase();
      const repo = new PluginEventsRepository(db);

      const external: BastionPlugin = {
        name: 'test-ext',
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        async onRequest() {
          return { action: 'pass' as const };
        },
      };

      const adapted = adaptPlugin(external, 50, repo);
      const result = await adapted.onRequest!(makeContext());

      expect(result).toBeDefined();
      expect(result!.blocked).toBeUndefined();
    });

    it('bridges onRequest block', async () => {
      db = createTestDatabase();
      const repo = new PluginEventsRepository(db);

      const external: BastionPlugin = {
        name: 'blocker',
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        async onRequest() {
          return { action: 'block' as const };
        },
      };

      const adapted = adaptPlugin(external, 50, repo);
      const result = await adapted.onRequest!(makeContext());

      expect(result!.blocked).toBeDefined();
      expect(result!.blocked!.reason).toContain('Blocked by plugin');
    });

    it('persists events from PluginResult automatically', async () => {
      db = createTestDatabase();
      const repo = new PluginEventsRepository(db);

      const external: BastionPlugin = {
        name: 'event-emitter',
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        async onRequest() {
          return {
            action: 'warn' as const,
            events: [{
              type: 'custom' as const,
              severity: 'medium' as const,
              rule: 'my-rule',
              detail: 'detected something',
              matchedText: 'secret',
            }],
          };
        },
      };

      const adapted = adaptPlugin(external, 50, repo);
      await adapted.onRequest!(makeContext());

      const records = repo.getByPlugin('event-emitter');
      expect(records).toHaveLength(1);
      expect(records[0].rule).toBe('my-rule');
      expect(records[0].matched_text).toBe('secret');
    });

    it('undefined hooks remain undefined on adapted plugin', () => {
      db = createTestDatabase();
      const repo = new PluginEventsRepository(db);

      const external: BastionPlugin = {
        name: 'minimal',
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
      };

      const adapted = adaptPlugin(external, 50, repo);
      expect(adapted.onRequest).toBeUndefined();
      expect(adapted.onResponse).toBeUndefined();
      expect(adapted.onResponseComplete).toBeUndefined();
    });

    it('bridges onResponse block', async () => {
      db = createTestDatabase();
      const repo = new PluginEventsRepository(db);

      const external: BastionPlugin = {
        name: 'resp-blocker',
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        async onResponse() {
          return { action: 'block' as const };
        },
      };

      const adapted = adaptPlugin(external, 50, repo);
      const result = await adapted.onResponse!({
        request: makeContext(),
        statusCode: 200,
        headers: {},
        body: '{}',
        parsedBody: {},
        isStreaming: false,
      });

      expect(result!.blocked).toBeDefined();
    });

    it('bridges onResponseComplete', async () => {
      db = createTestDatabase();
      const repo = new PluginEventsRepository(db);
      let receivedUsage: { inputTokens: number; outputTokens: number } | undefined;

      const external: BastionPlugin = {
        name: 'complete-handler',
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        async onResponseComplete(res) {
          receivedUsage = res.usage;
        },
      };

      const adapted = adaptPlugin(external, 50, repo);
      await adapted.onResponseComplete!({
        request: makeContext(),
        statusCode: 200,
        body: '{}',
        parsedBody: {},
        usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
        latencyMs: 500,
        isStreaming: false,
      });

      expect(receivedUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });
  });
});
