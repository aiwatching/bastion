/**
 * Test Tool Guard PI escalation — when pi:detected event fires,
 * tool-guard should adjust blockMinSeverity via piEscalationMap.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import {
  createToolGuardPlugin,
  resetAllPiEscalations,
  getPiEscalations,
  getPiEscalationCount,
  resetPiEscalation,
  type ToolGuardConfig,
} from '../../../src/plugins/builtin/tool-guard.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { resetEncryptionKey, getEncryptionKey } from '../../../src/storage/encryption.js';
import { mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { RequestContext, ResponseCompleteContext } from '../../../src/plugins/types.js';

describe('Tool Guard: PI escalation', () => {
  let db: Database.Database;
  let eventBus: PluginEventBus;

  beforeAll(() => {
    resetEncryptionKey();
    const tmpDir = `/tmp/bastion-tg-pi-esc-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    getEncryptionKey(`${tmpDir}/.key`);
    db = createTestDatabase();
  });

  afterAll(() => {
    db?.close();
    resetEncryptionKey();
  });

  beforeEach(() => {
    resetAllPiEscalations();
  });

  function createPlugin(overrides: Partial<ToolGuardConfig['piEscalation']> = {}) {
    eventBus = new PluginEventBus();
    const config: ToolGuardConfig = {
      enabled: true,
      action: 'block',
      recordAll: true,
      blockMinSeverity: 'critical',
      alertMinSeverity: 'high',
      alertDesktop: false,
      alertWebhookUrl: '',
      piEscalation: {
        enabled: true,
        scoreThreshold: 0.8,
        overrideSeverity: 'medium',
        scope: 'session',
        ttlMinutes: 30,
        ...overrides,
      },
    };
    return createToolGuardPlugin(db, config, eventBus);
  }

  function makeRequestContext(sessionId?: string): RequestContext {
    return {
      id: crypto.randomUUID(),
      provider: 'anthropic',
      model: 'claude-haiku-4.5-20241022',
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: '{}',
      parsedBody: {},
      isStreaming: true,
      startTime: Date.now(),
      sessionId,
    };
  }

  function makeResponseCompleteContext(reqCtx: RequestContext): ResponseCompleteContext {
    return {
      request: reqCtx,
      statusCode: 200,
      body: '{}',
      parsedBody: {},
      usage: { inputTokens: 50, outputTokens: 30, cacheCreationTokens: 0, cacheReadTokens: 0 },
      latencyMs: 100,
      isStreaming: false,
    };
  }

  it('escalates when score >= threshold', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-pi-1';

    // Emit PI detection
    eventBus.emit('pi:detected', { score: 0.95, label: 'injection', sessionId, requestId: 'req-1' });

    // Next request should see escalation
    const reqCtx = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx);

    expect(reqCtx._toolGuardStreamBlock).toBe('medium');
    expect(reqCtx._piEscalated).toBe(true);
    expect(reqCtx._piEscalationOverride).toBe('medium');
  });

  it('does not escalate when score < threshold', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-pi-2';

    eventBus.emit('pi:detected', { score: 0.5, label: 'injection', sessionId, requestId: 'req-2' });

    const reqCtx = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx);

    expect(reqCtx._toolGuardStreamBlock).toBe('critical'); // default
    expect(reqCtx._piEscalated).toBeUndefined();
  });

  it('does not escalate when piEscalation is disabled', async () => {
    const plugin = createPlugin({ enabled: false });
    const sessionId = 'session-pi-3';

    eventBus.emit('pi:detected', { score: 0.95, label: 'injection', sessionId, requestId: 'req-3' });

    const reqCtx = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx);

    expect(reqCtx._toolGuardStreamBlock).toBe('critical');
    expect(reqCtx._piEscalated).toBeUndefined();
  });

  it('scope=session persists escalation across requests', async () => {
    const plugin = createPlugin({ scope: 'session' });
    const sessionId = 'session-pi-persist';

    eventBus.emit('pi:detected', { score: 0.9, label: 'injection', sessionId, requestId: 'req-4' });

    // Request 1
    const reqCtx1 = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx1);
    expect(reqCtx1._piEscalated).toBe(true);

    // Simulate response complete
    await plugin.onResponseComplete!(makeResponseCompleteContext(reqCtx1));

    // Request 2 — still escalated
    const reqCtx2 = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx2);
    expect(reqCtx2._piEscalated).toBe(true);
    expect(reqCtx2._toolGuardStreamBlock).toBe('medium');
  });

  it('scope=request removes escalation after response completes', async () => {
    const plugin = createPlugin({ scope: 'request' });
    const sessionId = 'session-pi-request';

    eventBus.emit('pi:detected', { score: 0.9, label: 'injection', sessionId, requestId: 'req-5' });

    // Request 1 — escalated
    const reqCtx1 = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx1);
    expect(reqCtx1._piEscalated).toBe(true);
    expect(reqCtx1._toolGuardStreamBlock).toBe('medium');

    // Simulate response complete — should clean up
    await plugin.onResponseComplete!(makeResponseCompleteContext(reqCtx1));

    // Request 2 — no longer escalated
    const reqCtx2 = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx2);
    expect(reqCtx2._piEscalated).toBeUndefined();
    expect(reqCtx2._toolGuardStreamBlock).toBe('critical');
  });

  it('PI override vs threat-level: takes the stricter one', async () => {
    const plugin = createPlugin({ overrideSeverity: 'medium' });
    const sessionId = 'session-pi-vs-threat';

    eventBus.emit('pi:detected', { score: 0.95, label: 'injection', sessionId, requestId: 'req-6' });

    // threat-level=critical → blockMinSeverity='low' (stricter than 'medium')
    const reqCtx = makeRequestContext(sessionId);
    reqCtx._threatLevel = 'critical';
    await plugin.onRequest!(reqCtx);
    expect(reqCtx._toolGuardStreamBlock).toBe('low'); // threat path is stricter
    expect(reqCtx._piEscalated).toBe(true); // PI still marked
  });

  it('PI override is stricter than threat-level elevated', async () => {
    const plugin = createPlugin({ overrideSeverity: 'medium' });
    const sessionId = 'session-pi-stricter';

    eventBus.emit('pi:detected', { score: 0.95, label: 'injection', sessionId, requestId: 'req-7' });

    // threat-level=elevated → blockMinSeverity='high', PI='medium' → medium is stricter
    const reqCtx = makeRequestContext(sessionId);
    reqCtx._threatLevel = 'elevated';
    await plugin.onRequest!(reqCtx);
    expect(reqCtx._toolGuardStreamBlock).toBe('medium');
  });

  it('manual reset restores default behavior', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-pi-reset';

    eventBus.emit('pi:detected', { score: 0.95, label: 'injection', sessionId, requestId: 'req-8' });
    expect(getPiEscalationCount()).toBe(1);

    resetPiEscalation(sessionId);
    expect(getPiEscalationCount()).toBe(0);

    const reqCtx = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx);
    expect(reqCtx._piEscalated).toBeUndefined();
    expect(reqCtx._toolGuardStreamBlock).toBe('critical');
  });

  it('emits toolguard:pi-escalation event', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-pi-event';

    let emittedData: unknown = null;
    eventBus.on('toolguard:pi-escalation', (data: unknown) => {
      emittedData = data;
    });

    eventBus.emit('pi:detected', { score: 0.9, label: 'prompt-injection', sessionId, requestId: 'req-9' });

    expect(emittedData).toBeTruthy();
    const ev = emittedData as Record<string, unknown>;
    expect(ev.sessionId).toBe(sessionId);
    expect(ev.overrideSeverity).toBe('medium');
    expect(ev.score).toBe(0.9);

    // Ensure plugin was created (suppress unused var warning)
    expect(plugin.name).toBe('tool-guard');
  });

  it('different sessions do not affect each other', async () => {
    const plugin = createPlugin();

    eventBus.emit('pi:detected', { score: 0.95, label: 'injection', sessionId: 'session-A', requestId: 'req-a' });

    // Session A should be escalated
    const reqA = makeRequestContext('session-A');
    await plugin.onRequest!(reqA);
    expect(reqA._piEscalated).toBe(true);

    // Session B should not be escalated
    const reqB = makeRequestContext('session-B');
    await plugin.onRequest!(reqB);
    expect(reqB._piEscalated).toBeUndefined();
    expect(reqB._toolGuardStreamBlock).toBe('critical');
  });

  it('ignores events without sessionId', async () => {
    const plugin = createPlugin();

    eventBus.emit('pi:detected', { score: 0.95, label: 'injection', requestId: 'req-no-session' });

    expect(getPiEscalationCount()).toBe(0);

    // Ensure plugin was created
    expect(plugin.name).toBe('tool-guard');
  });

  it('getPiEscalations returns active entries', async () => {
    createPlugin();

    eventBus.emit('pi:detected', { score: 0.9, label: 'injection', sessionId: 'sess-1', requestId: 'r1' });
    eventBus.emit('pi:detected', { score: 0.85, label: 'jailbreak', sessionId: 'sess-2', requestId: 'r2' });

    const escalations = getPiEscalations();
    expect(escalations).toHaveLength(2);
    expect(escalations.map(e => e.sessionId).sort()).toEqual(['sess-1', 'sess-2']);
  });

  it('resetAllPiEscalations clears all entries', async () => {
    createPlugin();

    eventBus.emit('pi:detected', { score: 0.9, label: 'injection', sessionId: 's1', requestId: 'r1' });
    eventBus.emit('pi:detected', { score: 0.9, label: 'injection', sessionId: 's2', requestId: 'r2' });
    expect(getPiEscalationCount()).toBe(2);

    const count = resetAllPiEscalations();
    expect(count).toBe(2);
    expect(getPiEscalationCount()).toBe(0);
  });
});
