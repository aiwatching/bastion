/**
 * Test Tool Guard pi:detected escalation — when pi-classifier detects prompt injection,
 * tool-guard should lower blockMinSeverity for that session.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { createToolGuardPlugin, type ToolGuardConfig } from '../../../src/plugins/builtin/tool-guard.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { resetEncryptionKey, getEncryptionKey } from '../../../src/storage/encryption.js';
import { mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { RequestContext, ResponseInterceptContext } from '../../../src/plugins/types.js';

describe('Tool Guard: pi:detected escalation', () => {
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
    // (result may contain modifiedBody only if it meets the threshold)
    if (result?.modifiedBody) {
      expect(result.modifiedBody).not.toContain('BLOCKED');
    }
  });

  it('escalates session when pi:detected event is emitted', async () => {
    const plugin = createPlugin();
    const sessionId = 'session-injected';

    // Simulate pi-classifier detecting injection
    eventBus.emit('pi:detected', {
      sessionId,
      label: 'INJECTION',
      score: 0.95,
      detections: 1,
    });

    // Now process a request with medium-severity tool call
    const reqCtx = makeRequestContext(sessionId);
    await plugin.onRequest!(reqCtx);

    // For streaming requests, the escalated severity should be used
    const streamReqCtx = makeRequestContext(sessionId);
    streamReqCtx.isStreaming = true;
    await plugin.onRequest!(streamReqCtx);
    expect(streamReqCtx._toolGuardStreamBlock).toBe('medium');
  });

  it('non-escalated sessions use default blockMinSeverity', async () => {
    const plugin = createPlugin();

    // Escalate session A
    eventBus.emit('pi:detected', { sessionId: 'session-A', label: 'INJECTION', score: 0.9, detections: 1 });

    // Session B should not be affected
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
