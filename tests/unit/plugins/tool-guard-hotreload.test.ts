/**
 * Test that Tool Guard action mode hot-reload works correctly.
 * When action is changed from 'block' to 'audit' via ConfigManager,
 * the plugin should stop blocking responses.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { createToolGuardPlugin, type ToolGuardConfig } from '../../../src/plugins/builtin/tool-guard.js';
import { resetEncryptionKey, getEncryptionKey } from '../../../src/storage/encryption.js';
import { mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { RequestContext, ResponseInterceptContext } from '../../../src/plugins/types.js';

describe('Tool Guard: action mode hot-reload', () => {
  let db: Database.Database;

  // Mutable config — simulates what ConfigManager.get().plugins.toolGuard returns
  const liveConfig = {
    action: 'block' as string,
    recordAll: true,
    blockMinSeverity: 'critical' as string,
    alertMinSeverity: 'high' as string,
  };

  beforeAll(() => {
    resetEncryptionKey();
    const tmpDir = `/tmp/bastion-tg-hotreload-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    getEncryptionKey(`${tmpDir}/.key`);
    db = createTestDatabase();
  });

  afterAll(() => {
    db?.close();
    resetEncryptionKey();
  });

  function createPlugin() {
    const config: ToolGuardConfig = {
      enabled: true,
      action: 'block',
      recordAll: true,
      blockMinSeverity: 'critical',
      alertMinSeverity: 'high',
      alertDesktop: false,
      alertWebhookUrl: '',
      getLiveConfig: () => ({ ...liveConfig }),
    };
    return createToolGuardPlugin(db, config);
  }

  // The dangerous response body (contains rm -rf /)
  const dangerousBody = JSON.stringify({
    id: 'msg_tool_01',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: "I'll delete those files." },
      { type: 'tool_use', id: 'toolu_01', name: 'bash', input: { command: 'rm -rf /' } },
    ],
    model: 'claude-haiku-4.5-20241022',
    usage: { input_tokens: 50, output_tokens: 30 },
  });

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
    };
  }

  function makeResponseContext(reqCtx: RequestContext): ResponseInterceptContext {
    return {
      request: reqCtx,
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: dangerousBody,
      parsedBody: JSON.parse(dangerousBody),
      isStreaming: false,
    };
  }

  it('blocks dangerous tool call when action=block', async () => {
    liveConfig.action = 'block';
    liveConfig.blockMinSeverity = 'critical';
    const plugin = createPlugin();

    const reqCtx = makeRequestContext();
    await plugin.onRequest!(reqCtx);

    const resCtx = makeResponseContext(reqCtx);
    const result = await plugin.onResponse!(resCtx);

    expect(result).toBeDefined();
    expect(result!.blocked).toBeDefined();
    expect(result!.blocked!.reason).toContain('Tool Guard');
  });

  it('allows dangerous tool call when action=audit (hot-reload)', async () => {
    // Simulate config change: action goes from 'block' to 'audit'
    liveConfig.action = 'audit';
    const plugin = createPlugin();

    const reqCtx = makeRequestContext();
    await plugin.onRequest!(reqCtx);

    const resCtx = makeResponseContext(reqCtx);
    const result = await plugin.onResponse!(resCtx);

    // In audit mode, onResponse should return void (no blocking)
    expect(result).toBeUndefined();
  });

  it('hot-reload takes effect on same plugin instance', async () => {
    // Start with action=block
    liveConfig.action = 'block';
    liveConfig.blockMinSeverity = 'critical';
    const plugin = createPlugin();

    // First request: should block
    const reqCtx1 = makeRequestContext();
    await plugin.onRequest!(reqCtx1);
    const resCtx1 = makeResponseContext(reqCtx1);
    const result1 = await plugin.onResponse!(resCtx1);
    expect(result1?.blocked).toBeDefined();

    // Change action to 'audit' (simulates Dashboard config change)
    liveConfig.action = 'audit';

    // Second request on SAME plugin instance: should NOT block
    const reqCtx2 = makeRequestContext();
    await plugin.onRequest!(reqCtx2);
    const resCtx2 = makeResponseContext(reqCtx2);
    const result2 = await plugin.onResponse!(resCtx2);
    expect(result2).toBeUndefined();

    // Change back to 'block'
    liveConfig.action = 'block';

    // Third request: should block again
    const reqCtx3 = makeRequestContext();
    await plugin.onRequest!(reqCtx3);
    const resCtx3 = makeResponseContext(reqCtx3);
    const result3 = await plugin.onResponse!(resCtx3);
    expect(result3?.blocked).toBeDefined();
  });

  it('streaming guard is only created when action=block', async () => {
    const plugin = createPlugin();

    // action=block + streaming: should set _toolGuardStreamBlock
    liveConfig.action = 'block';
    liveConfig.blockMinSeverity = 'critical';
    const reqCtx1 = makeRequestContext();
    reqCtx1.isStreaming = true;
    await plugin.onRequest!(reqCtx1);
    expect(reqCtx1._toolGuardStreamBlock).toBe('critical');

    // action=audit + streaming: should NOT set _toolGuardStreamBlock
    liveConfig.action = 'audit';
    const reqCtx2 = makeRequestContext();
    reqCtx2.isStreaming = true;
    await plugin.onRequest!(reqCtx2);
    expect(reqCtx2._toolGuardStreamBlock).toBeUndefined();
  });
});
