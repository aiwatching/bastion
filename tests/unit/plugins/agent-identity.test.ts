import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { createAgentIdentityPlugin, generateAgentSecret, encryptSecret } from '../../../src/plugins/builtin/agent-identity.js';
import { AgentsRepository } from '../../../src/storage/repositories/agents.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { resetEncryptionKey, getEncryptionKey } from '../../../src/storage/encryption.js';
import { mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BastionConfig } from '../../../src/config/schema.js';
import type { RequestContext } from '../../../src/plugins/types.js';

function makeConfig(overrides?: Partial<NonNullable<BastionConfig['plugins']['agentIdentity']>>): BastionConfig {
  return {
    server: { host: '0.0.0.0', port: 9800, failMode: 'open', auth: { enabled: false, token: '', excludePaths: [] } },
    logging: { level: 'warn' },
    plugins: {
      metrics: { enabled: false },
      dlp: { enabled: false, action: 'warn', patterns: [], remotePatterns: { url: '', branch: '', syncOnStart: false, syncIntervalMinutes: 0 }, aiValidation: { enabled: false, provider: 'anthropic', model: '', apiKey: '', ollamaEndpoint: '', ollamaModel: '', timeoutMs: 0, cacheSize: 0 }, semantics: { sensitivePatterns: [], nonSensitiveNames: [] } },
      optimizer: { enabled: false, cache: false, cacheTtlSeconds: 0, trimWhitespace: false, reorderForCache: false },
      audit: { enabled: false, rawData: false, rawMaxBytes: 0, summaryMaxBytes: 0 },
      toolGuard: { enabled: false, action: 'audit', recordAll: false, blockMinSeverity: 'critical', alertMinSeverity: 'high', alertDesktop: false, alertWebhookUrl: '' },
      agentIdentity: {
        enabled: true,
        mode: 'auto',
        defaultTrustLevel: 'standard',
        hmacRequired: false,
        agents: [],
        ...overrides,
      },
    },
    retention: { requestsHours: 720, dlpEventsHours: 720, toolCallsHours: 720, optimizerEventsHours: 720, sessionsHours: 720, auditLogHours: 720, pluginEventsHours: 720 },
    timeouts: { upstream: 30000, plugin: 5000 },
  } as BastionConfig;
}

function makeContext(agentId?: string): RequestContext {
  return {
    id: crypto.randomUUID(),
    provider: 'anthropic',
    model: 'claude-haiku-4.5-20241022',
    method: 'POST',
    path: '/v1/messages',
    headers: agentId ? { 'x-bastion-agent-id': agentId } : {},
    body: '{}',
    parsedBody: {},
    isStreaming: false,
    startTime: Date.now(),
    sessionId: 'session-1',
  };
}

describe('Agent Identity Plugin', () => {
  let db: Database.Database;
  let eventBus: PluginEventBus;

  beforeAll(() => {
    resetEncryptionKey();
    const tmpDir = `/tmp/bastion-agent-identity-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    getEncryptionKey(`${tmpDir}/.key`);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('does nothing when no agent header', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const config = makeConfig();
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);
    const ctx = makeContext(); // no agent header
    const result = await plugin.onRequest!(ctx);
    expect(result).toBeUndefined();
    expect(ctx.agentId).toBeUndefined();
  });

  it('does nothing when feature disabled', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const config = makeConfig({ enabled: false });
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);
    const ctx = makeContext('test-agent');
    const result = await plugin.onRequest!(ctx);
    expect(result).toBeUndefined();
    expect(ctx.agentId).toBeUndefined();
  });

  it('auto-registers unknown agent in auto mode', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const config = makeConfig();
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const events: string[] = [];
    eventBus.on('agent:registered', () => events.push('registered'));
    eventBus.on('agent:identified', () => events.push('identified'));

    const ctx = makeContext('new-agent');
    await plugin.onRequest!(ctx);

    expect(ctx.agentId).toBeDefined();
    expect(ctx.agentTrustLevel).toBe('standard');
    expect(ctx._agentToolScope).toBeNull(); // all tools allowed
    expect(events).toContain('registered');
    expect(events).toContain('identified');
  });

  it('rejects unknown agent in strict mode', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const config = makeConfig({ mode: 'strict' });
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const events: string[] = [];
    eventBus.on('agent:rejected', () => events.push('rejected'));

    const ctx = makeContext('unknown-agent');
    const result = await plugin.onRequest!(ctx);

    expect(result?.shortCircuit?.statusCode).toBe(403);
    expect(ctx.agentId).toBeUndefined();
    expect(events).toContain('rejected');
  });

  it('identifies existing agent by name', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const repo = new AgentsRepository(db);
    repo.insert({ id: 'agent-123', name: 'my-agent', trust_level: 'trusted', tool_scope: ['bash'] });

    const config = makeConfig();
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const ctx = makeContext('my-agent');
    await plugin.onRequest!(ctx);

    expect(ctx.agentId).toBe('agent-123');
    expect(ctx.agentTrustLevel).toBe('trusted');
    expect(ctx._agentToolScope).toEqual(['bash']);
  });

  it('rejects suspended agent', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const repo = new AgentsRepository(db);
    repo.insert({ id: 'agent-s', name: 'suspended-agent' });
    repo.setStatus('agent-s', 'suspended');

    const config = makeConfig();
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const ctx = makeContext('suspended-agent');
    const result = await plugin.onRequest!(ctx);

    expect(result?.shortCircuit?.statusCode).toBe(403);
    expect(JSON.parse(result!.shortCircuit!.body)).toHaveProperty('error', 'Agent suspended');
  });

  it('rejects revoked agent', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const repo = new AgentsRepository(db);
    repo.insert({ id: 'agent-r', name: 'revoked-agent' });
    repo.setStatus('agent-r', 'revoked');

    const config = makeConfig();
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const ctx = makeContext('revoked-agent');
    const result = await plugin.onRequest!(ctx);

    expect(result?.shortCircuit?.statusCode).toBe(403);
  });

  it('HMAC verification succeeds with valid signature', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const repo = new AgentsRepository(db);
    const { secret, hash, encrypted } = generateAgentSecret();
    repo.insert({ id: 'agent-hmac', name: 'hmac-agent', secret_hash: hash, encrypted_secret: encrypted });

    const config = makeConfig({ hmacRequired: true });
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const timestamp = String(Date.now());
    const payload = `${timestamp}\nPOST\n/v1/messages`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const ctx = makeContext('hmac-agent');
    ctx.headers['x-bastion-agent-signature'] = signature;
    ctx.headers['x-bastion-agent-timestamp'] = timestamp;

    await plugin.onRequest!(ctx);
    expect(ctx.agentId).toBe('agent-hmac');
  });

  it('HMAC verification rejects invalid signature', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const repo = new AgentsRepository(db);
    const { hash, encrypted } = generateAgentSecret();
    repo.insert({ id: 'agent-hmac2', name: 'hmac-agent2', secret_hash: hash, encrypted_secret: encrypted });

    const config = makeConfig({ hmacRequired: true });
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const ctx = makeContext('hmac-agent2');
    ctx.headers['x-bastion-agent-signature'] = 'a'.repeat(64);
    ctx.headers['x-bastion-agent-timestamp'] = String(Date.now());

    const result = await plugin.onRequest!(ctx);
    expect(result?.shortCircuit?.statusCode).toBe(403);
  });

  it('HMAC required rejects missing signature', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const repo = new AgentsRepository(db);
    const { hash, encrypted } = generateAgentSecret();
    repo.insert({ id: 'agent-hmac3', name: 'hmac-agent3', secret_hash: hash, encrypted_secret: encrypted });

    const config = makeConfig({ hmacRequired: true });
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const ctx = makeContext('hmac-agent3');
    // No signature headers
    const result = await plugin.onRequest!(ctx);
    expect(result?.shortCircuit?.statusCode).toBe(403);
  });

  it('pre-registers agents from config', async () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const config = makeConfig({
      agents: [
        { name: 'config-agent', description: 'From config', trustLevel: 'trusted', toolScope: ['bash'] },
      ],
    });
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);

    const ctx = makeContext('config-agent');
    await plugin.onRequest!(ctx);

    expect(ctx.agentId).toBeDefined();
    expect(ctx.agentTrustLevel).toBe('trusted');
    expect(ctx._agentToolScope).toEqual(['bash']);
  });

  it('generateAgentSecret produces valid secret, hash, and encrypted', () => {
    const { secret, hash, encrypted } = generateAgentSecret();
    expect(secret).toHaveLength(64); // 32 bytes hex
    expect(hash).toHaveLength(16); // SHA256 prefix
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it('has priority 0', () => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    const config = makeConfig();
    const plugin = createAgentIdentityPlugin(db, () => config, eventBus);
    expect(plugin.priority).toBe(0);
    expect(plugin.name).toBe('agent-identity');
  });
});
