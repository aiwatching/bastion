/**
 * Test Tool Guard threat-level escalation — when threat-scorer sets context._threatLevel,
 * tool-guard should adjust blockMinSeverity accordingly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { createToolGuardPlugin, type ToolGuardConfig } from '../../../src/plugins/builtin/tool-guard.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { resetEncryptionKey, getEncryptionKey } from '../../../src/storage/encryption.js';
import { mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { RequestContext, ResponseInterceptContext } from '../../../src/plugins/types.js';

describe('Tool Guard: threat-level escalation', () => {
  let db: Database.Database;
  let eventBus: PluginEventBus;

  beforeAll(() => {
    resetEncryptionKey();
    const tmpDir = `/tmp/bastion-tg-escalation-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    getEncryptionKey(`${tmpDir}/.key`);
    db = createTestDatabase();
  });

  afterAll(() => {
    db?.close();
    resetEncryptionKey();
  });

  function createPlugin() {
    eventBus = new PluginEventBus();
    const config: ToolGuardConfig = {
      enabled: true,
      action: 'block',
      recordAll: true,
      blockMinSeverity: 'critical', // only block critical by default
      alertMinSeverity: 'high',
      alertDesktop: false,
      alertWebhookUrl: '',
    };
    return createToolGuardPlugin(db, config, eventBus);
  }

  // Response with a medium-severity tool call (file write)
  const mediumSeverityBody = JSON.stringify({
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Writing file.' },
      { type: 'tool_use', id: 'toolu_01', name: 'write', input: { path: '/etc/passwd', content: 'hacked' } },
    ],
    model: 'claude-haiku-4.5-20241022',
    usage: { input_tokens: 50, output_tokens: 30 },
  });

  function makeRequestContext(sessionId: string): RequestContext {
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
      sessionId,
    };
  }

  function makeResponseContext(reqCtx: RequestContext): ResponseInterceptContext {
    return {
      request: reqCtx,
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: mediumSeverityBody,
      parsedBody: JSON.parse(mediumSeverityBody),
      isStreaming: false,
    };
  }

  it('does not block medium-severity tool call without escalation', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-clean';

    const reqCtx = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx);

    const resCtx = makeResponseContext(reqCtx);
    const result = await plugin.onResponse!(resCtx);

    // blockMinSeverity is 'critical', medium-severity should NOT be blocked
    if (result?.modifiedBody) {
      expect(result.modifiedBody).not.toContain('BLOCKED');
    }
  });

  it('escalates session when _threatLevel is set to high', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-injected';

    // Simulate threat-scorer setting _threatLevel on the context
    const streamReqCtx = makeRequestContext(sessionId);
    streamReqCtx.isStreaming = true;
    streamReqCtx._threatLevel = 'high';
    await plugin.onRequest!(streamReqCtx);
    // high threat → blockMinSeverity should be 'medium'
    expect(streamReqCtx._toolGuardStreamBlock).toBe('medium');
  });

  it('critical threat level blocks all severities', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-critical';

    const reqCtx = makeRequestContext(sessionId);
    reqCtx.isStreaming = true;
    reqCtx._threatLevel = 'critical';
    await plugin.onRequest!(reqCtx);
    expect(reqCtx._toolGuardStreamBlock).toBe('low');
  });

  it('elevated threat level blocks high+', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-elevated';

    const reqCtx = makeRequestContext(sessionId);
    reqCtx.isStreaming = true;
    reqCtx._threatLevel = 'elevated';
    await plugin.onRequest!(reqCtx);
    expect(reqCtx._toolGuardStreamBlock).toBe('high');
  });

  it('non-escalated sessions use default blockMinSeverity', async () => {
    const plugin = createPlugin();

    // Session B has no _threatLevel set
    const reqCtx = makeRequestContext('session-B');
    reqCtx.isStreaming = true;
    await plugin.onRequest!(reqCtx);
    expect(reqCtx._toolGuardStreamBlock).toBe('critical');
  });

  it('requests without sessionId use default blockMinSeverity', async () => {
    const plugin = createPlugin();

    const reqCtx: RequestContext = {
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
      // no sessionId
    };
    await plugin.onRequest!(reqCtx);
    expect(reqCtx._toolGuardStreamBlock).toBe('critical');
  });
});
