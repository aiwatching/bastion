import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { request } from 'node:http';
import { createTestDatabase } from '../../src/storage/database.js';
import { PluginManager } from '../../src/plugins/index.js';
import { createMetricsCollectorPlugin } from '../../src/plugins/builtin/metrics-collector.js';
import { createToolGuardPlugin } from '../../src/plugins/builtin/tool-guard.js';
import { clearProviders, registerProvider, type ProviderConfig } from '../../src/proxy/providers/index.js';
import { createProxyServer } from '../../src/proxy/server.js';
import { ToolCallsRepository } from '../../src/storage/repositories/tool-calls.js';
import { ToolGuardRulesRepository } from '../../src/storage/repositories/tool-guard-rules.js';
import { AuditLogRepository } from '../../src/storage/repositories/audit-log.js';
import { resetEncryptionKey, getEncryptionKey } from '../../src/storage/encryption.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { BastionConfig } from '../../src/config/schema.js';
import { ConfigManager } from '../../src/config/manager.js';

const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

/** Mock upstream that returns a given response body */
function createMockUpstream(
  getResponse: () => { body: string; headers?: Record<string, string>; status?: number },
): Promise<{ server: Server; port: number }> {
  return new Promise((res) => {
    const server = createServer((req: IncomingMessage, resp: ServerResponse) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const r = getResponse();
        resp.writeHead(r.status ?? 200, {
          'content-type': 'application/json',
          ...r.headers,
        });
        resp.end(r.body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      res({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

function httpPost(port: number, path: string, body: string, headers: Record<string, string> = {}): Promise<{
  statusCode: number; body: string; headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Integration: Tool Guard Pipeline', () => {
  let db: Database.Database;
  let gateway: Server;
  let gatewayPort: number;
  let mockUpstream: { server: Server; port: number };
  let currentFixture: string;

  const dangerousFixture = readFileSync(resolve(FIXTURES_DIR, 'anthropic-tool-use.json'), 'utf-8');
  const safeFixture = readFileSync(resolve(FIXTURES_DIR, 'anthropic-tool-use-safe.json'), 'utf-8');

  const testProvider: ProviderConfig = {
    name: 'anthropic',
    baseUrl: '',
    authHeader: 'x-api-key',
    transformHeaders: (h) => {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(h)) {
        if (['x-api-key', 'content-type'].includes(k.toLowerCase())) result[k] = v;
      }
      return result;
    },
    extractModel: (body) => (body.model as string) ?? 'unknown',
    extractUsage: (body) => {
      const usage = body.usage as Record<string, number> | undefined;
      return {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      };
    },
  };

  beforeAll(async () => {
    resetEncryptionKey();
    const tmpDir = `/tmp/bastion-toolguard-test-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    getEncryptionKey(`${tmpDir}/.key`);

    currentFixture = safeFixture;
    mockUpstream = await createMockUpstream(() => ({ body: currentFixture }));

    db = createTestDatabase();

    clearProviders();
    testProvider.baseUrl = `http://127.0.0.1:${mockUpstream.port}`;
    registerProvider('/v1/messages', testProvider);

    const pluginManager = new PluginManager(5000);
    pluginManager.register(createMetricsCollectorPlugin(db));
    pluginManager.register(createToolGuardPlugin(db, {
      enabled: true,
      action: 'block',
      recordAll: true,
      blockMinSeverity: 'critical',
      alertMinSeverity: 'high',
      alertDesktop: false,
      alertWebhookUrl: '',
    }));

    const config: BastionConfig = {
      server: { host: '127.0.0.1', port: 0 },
      logging: { level: 'warn' },
      plugins: {
        metrics: { enabled: true },
        dlp: { enabled: false, action: 'warn', patterns: [] },
        optimizer: { enabled: false, cache: false, cacheTtlSeconds: 300, trimWhitespace: false, reorderForCache: false },
        audit: { enabled: false },
        toolGuard: { enabled: true, action: 'block', blockMinSeverity: 'critical', alertMinSeverity: 'high', alertDesktop: false, alertWebhookUrl: '' },
      },
      retention: { requestsHours: 720, dlpEventsHours: 720, toolCallsHours: 720, optimizerEventsHours: 720, sessionsHours: 720, auditLogHours: 24 },
      timeouts: { upstream: 10000, plugin: 5000 },
    };
    const configManager = new ConfigManager(config);
    gateway = createProxyServer(config, pluginManager, () => {}, db, configManager);

    await new Promise<void>((resolve) => {
      gateway.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = gateway.address();
    gatewayPort = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(() => {
    gateway?.close();
    mockUpstream?.server.close();
    db?.close();
    resetEncryptionKey();
  });

  function sendRequest(body: Record<string, unknown> = {}) {
    return httpPost(
      gatewayPort,
      '/v1/messages',
      JSON.stringify({
        model: 'claude-haiku-4.5-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
        ...body,
      }),
      { 'x-api-key': 'sk-test-key' },
    );
  }

  // ── Non-streaming tests ──

  it('blocks dangerous tool_use in non-streaming response (rm -rf /)', async () => {
    currentFixture = dangerousFixture;
    const result = await sendRequest();

    // action=block + severity=critical → should be blocked
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error.type).toBe('gateway_response_blocked');
    expect(body.error.message).toContain('Tool Guard');
  });

  it('records the blocked tool call in DB', async () => {
    await new Promise((r) => setTimeout(r, 100));
    const toolCallsRepo = new ToolCallsRepository(db);
    const recent = toolCallsRepo.getRecent(10);
    const dangerous = recent.find(tc => tc.tool_name === 'bash' && tc.severity === 'critical');
    expect(dangerous).toBeDefined();
    expect(dangerous!.rule_id).toBe('fs-rm-rf-root');
    expect(dangerous!.category).toBe('destructive-fs');
  });

  it('writes audit_log entry when blocking dangerous tool call', async () => {
    const auditRepo = new AuditLogRepository(db);
    // The block test above should have triggered an auto-audit
    // Find the audit entry for the most recent blocked request
    const recent = auditRepo.getRecent(10);
    const tgAudit = recent.find(a => a.tool_guard_hit === 1);
    expect(tgAudit).toBeDefined();
    expect(tgAudit!.request_id).toBeTruthy();

    // Verify the raw content is stored (not just a 403 error)
    const raw = auditRepo.getByRequestId(tgAudit!.request_id);
    expect(raw).not.toBeNull();
    // The response body should contain the original LLM response with the dangerous tool call
    expect(raw!.response).toContain('bash');
    expect(raw!.response).toContain('rm -rf');
  });

  it('allows safe tool_use through (read_file)', async () => {
    currentFixture = safeFixture;
    const result = await sendRequest();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.content).toHaveLength(2);
    expect(body.content[1].name).toBe('read_file');
  });

  it('records safe tool calls with info severity (recordAll=true)', async () => {
    await new Promise((r) => setTimeout(r, 100));
    const toolCallsRepo = new ToolCallsRepository(db);
    const recent = toolCallsRepo.getRecent(10);
    const safe = recent.find(tc => tc.tool_name === 'read_file');
    expect(safe).toBeDefined();
    expect(safe!.severity).toBe('info');
    expect(safe!.action).toBe('pass');
  });

  // ── Rules API tests ──

  it('GET /api/tool-guard/rules returns seeded built-in rules', async () => {
    const res = await httpGet(gatewayPort, '/api/tool-guard/rules');
    expect(res.statusCode).toBe(200);
    const rules = JSON.parse(res.body);
    expect(rules.length).toBeGreaterThanOrEqual(26); // all built-in rules
    // At this point custom rules may exist from earlier tests, so check builtins only
    const builtins = rules.filter((r: { is_builtin: number }) => r.is_builtin === 1);
    expect(builtins.length).toBe(26);
  });

  it('POST /api/tool-guard/rules creates custom rule', async () => {
    const res = await httpPost(gatewayPort, '/api/tool-guard/rules', JSON.stringify({
      name: 'block-drop-table',
      description: 'Block SQL DROP TABLE',
      input_pattern: 'DROP\\s+TABLE',
      input_flags: 'i',
      severity: 'critical',
      category: 'sql-injection',
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.id).toContain('custom-');
  });

  it('custom rule appears in GET listing', async () => {
    const res = await httpGet(gatewayPort, '/api/tool-guard/rules');
    const rules = JSON.parse(res.body);
    const custom = rules.find((r: { name: string }) => r.name === 'block-drop-table');
    expect(custom).toBeDefined();
    expect(custom.is_builtin).toBe(0);
    expect(custom.severity).toBe('critical');
  });

  it('PUT /api/tool-guard/rules/:id toggles enabled state', async () => {
    // Disable a built-in rule
    const res = await httpPost(gatewayPort, '/api/tool-guard/rules', '{}'); // just to get all rules
    const listRes = await httpGet(gatewayPort, '/api/tool-guard/rules');
    const rules = JSON.parse(listRes.body);
    const firstBuiltin = rules.find((r: { is_builtin: number }) => r.is_builtin === 1);

    const toggleRes = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = request(
        { hostname: '127.0.0.1', port: gatewayPort, path: `/api/tool-guard/rules/${encodeURIComponent(firstBuiltin.id)}`, method: 'PUT', headers: { 'content-type': 'application/json' } },
        (resp) => {
          let data = '';
          resp.on('data', (chunk) => { data += chunk; });
          resp.on('end', () => resolve({ statusCode: resp.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ enabled: false }));
      req.end();
    });
    expect(toggleRes.statusCode).toBe(200);

    // Verify disabled
    const afterRes = await httpGet(gatewayPort, '/api/tool-guard/rules');
    const after = JSON.parse(afterRes.body);
    const toggled = after.find((r: { id: string }) => r.id === firstBuiltin.id);
    expect(toggled.enabled).toBe(0);
  });

  it('DELETE rejects built-in rules', async () => {
    const listRes = await httpGet(gatewayPort, '/api/tool-guard/rules');
    const rules = JSON.parse(listRes.body);
    const builtin = rules.find((r: { is_builtin: number }) => r.is_builtin === 1);

    const delRes = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = request(
        { hostname: '127.0.0.1', port: gatewayPort, path: `/api/tool-guard/rules/${encodeURIComponent(builtin.id)}`, method: 'DELETE' },
        (resp) => {
          let data = '';
          resp.on('data', (chunk) => { data += chunk; });
          resp.on('end', () => resolve({ statusCode: resp.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(delRes.statusCode).toBe(400);
    expect(JSON.parse(delRes.body).error).toContain('Cannot delete built-in');
  });

  it('disabled rule no longer blocks matching tool calls', async () => {
    // Disable the rm-rf rule
    const rulesRepo = new ToolGuardRulesRepository(db);
    rulesRepo.toggle('fs-rm-rf-root', false);
    rulesRepo.toggle('fs-rm-rf-wildcard', false);

    // Now a "rm -rf /" response should pass through (no critical match)
    currentFixture = dangerousFixture;
    const result = await sendRequest();

    // With those two rules disabled, the remaining rules may not match "rm -rf /"
    // at critical level — so it should pass through
    expect(result.statusCode).toBe(200);

    // Re-enable for subsequent tests
    rulesRepo.toggle('fs-rm-rf-root', true);
    rulesRepo.toggle('fs-rm-rf-wildcard', true);
  });

  it('stats API reflects tool guard data', async () => {
    const res = await httpGet(gatewayPort, '/api/tool-guard/stats');
    expect(res.statusCode).toBe(200);
    const stats = JSON.parse(res.body);
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });
});
