import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { request } from 'node:http';
import { createTestDatabase } from '../../src/storage/database.js';
import { PluginManager } from '../../src/plugins/index.js';
import { createMetricsCollectorPlugin } from '../../src/plugins/builtin/metrics-collector.js';
import { createDlpScannerPlugin } from '../../src/plugins/builtin/dlp-scanner.js';
import { createTokenOptimizerPlugin } from '../../src/plugins/builtin/token-optimizer.js';
import { clearProviders, registerProvider, type ProviderConfig } from '../../src/proxy/providers/index.js';
import { createProxyServer, startServer } from '../../src/proxy/server.js';
import { RequestsRepository } from '../../src/storage/repositories/requests.js';
import { resetEncryptionKey, getEncryptionKey } from '../../src/storage/encryption.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { BastionConfig } from '../../src/config/schema.js';
import { ConfigManager } from '../../src/config/manager.js';

const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

// Mock upstream server that returns fixture data
function createMockUpstream(responseBody: string, statusCode = 200): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(statusCode, { 'content-type': 'application/json' });
        res.end(responseBody);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function httpPost(port: number, path: string, body: string, headers: Record<string, string> = {}): Promise<{
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body: data, headers: res.headers });
        });
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

describe('Integration: Proxy Pipeline', () => {
  let db: Database.Database;
  let mockUpstream: { server: Server; port: number };
  let gateway: Server;
  let gatewayPort: number;

  const anthropicFixture = readFileSync(resolve(FIXTURES_DIR, 'anthropic-response.json'), 'utf-8');

  const testProvider: ProviderConfig = {
    name: 'anthropic',
    baseUrl: '', // Will be set dynamically
    authHeader: 'x-api-key',
    transformHeaders: (h) => {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(h)) {
        if (['x-api-key', 'content-type', 'accept'].includes(k.toLowerCase())) {
          result[k] = v;
        }
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
    // Set up encryption key
    resetEncryptionKey();
    const tmpDir = `/tmp/bastion-integration-test-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    getEncryptionKey(`${tmpDir}/.key`);

    // Start mock upstream
    mockUpstream = await createMockUpstream(anthropicFixture);

    // Set up test database
    db = createTestDatabase();

    // Configure provider to point to mock upstream
    clearProviders();
    testProvider.baseUrl = `http://127.0.0.1:${mockUpstream.port}`;
    registerProvider('/v1/messages', testProvider);

    // Set up plugin manager
    const pluginManager = new PluginManager(5000);
    pluginManager.register(createMetricsCollectorPlugin(db));
    pluginManager.register(createDlpScannerPlugin(db, {
      action: 'block',
      patterns: ['high-confidence', 'validated'],
    }));
    pluginManager.register(createTokenOptimizerPlugin(db, {
      cache: true,
      trimWhitespace: true,
      reorderForCache: false,
    }));

    const config: BastionConfig = {
      server: { host: '127.0.0.1', port: 0 },
      logging: { level: 'warn' },
      plugins: {
        metrics: { enabled: true },
        dlp: { enabled: true, action: 'block', patterns: ['high-confidence', 'validated'] },
        optimizer: { enabled: true, cache: true, cacheTtlSeconds: 300, trimWhitespace: true, reorderForCache: false },
        audit: { enabled: false, retentionHours: 168 },
      },
      timeouts: { upstream: 10000, plugin: 5000 },
    };

    const configManager = new ConfigManager(config);
    gateway = createProxyServer(config, pluginManager, () => {}, db, configManager);

    // Start on random port
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

  it('proxies a request to Anthropic and returns the response', async () => {
    const result = await httpPost(
      gatewayPort,
      '/v1/messages',
      JSON.stringify({
        model: 'claude-haiku-4.5-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Say hello' }],
      }),
      { 'x-api-key': 'sk-test-key' },
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.content[0].text).toBe('Hello! How can I help you today?');
  });

  it('records metrics in the database', async () => {
    // Wait a tick for async metric recording
    await new Promise((r) => setTimeout(r, 100));

    const repo = new RequestsRepository(db);
    const stats = repo.getStats();
    expect(stats.total_requests).toBeGreaterThanOrEqual(1);
  });

  it('returns health check', async () => {
    const result = await httpGet(gatewayPort, '/health');
    expect(result.statusCode).toBe(200);
    const health = JSON.parse(result.body);
    expect(health.status).toBe('ok');
    expect(health.pid).toBe(process.pid);
  });

  it('passes through unknown POST paths to upstream', async () => {
    // Unknown paths are forwarded transparently (e.g. auth endpoints)
    const result = await httpPost(gatewayPort, '/unknown/path', '{}');
    // Will get a response from upstream (or 502 if upstream rejects)
    expect([200, 400, 401, 403, 404, 502]).toContain(result.statusCode);
  });

  it('passes through non-POST requests to upstream', async () => {
    // GET to provider paths are forwarded (e.g. model listing)
    const result = await httpGet(gatewayPort, '/v1/messages');
    expect([200, 400, 401, 403, 404, 405, 502]).toContain(result.statusCode);
  });

  it('serves the dashboard page', async () => {
    const result = await httpGet(gatewayPort, '/dashboard');
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Bastion AI Gateway');
  });

  it('serves the stats API', async () => {
    const result = await httpGet(gatewayPort, '/api/stats');
    expect(result.statusCode).toBe(200);
    const data = JSON.parse(result.body);
    expect(data.stats).toBeDefined();
    expect(data.recent).toBeDefined();
    expect(data.uptime).toBeGreaterThan(0);
  });

  it('blocks requests with sensitive data (DLP)', async () => {
    const result = await httpPost(
      gatewayPort,
      '/v1/messages',
      JSON.stringify({
        model: 'claude-haiku-4.5-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'My AWS key is AKIAIOSFODNN7EXAMPLE' }],
      }),
      { 'x-api-key': 'sk-test-key' },
    );

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error.type).toBe('gateway_blocked');
  });

  it('serves cached response on second identical request', async () => {
    const requestBody = JSON.stringify({
      model: 'claude-haiku-4.5-20241022',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Cache test message' }],
    });

    // First request — goes to upstream
    const first = await httpPost(gatewayPort, '/v1/messages', requestBody, {
      'x-api-key': 'sk-test',
    });
    expect(first.statusCode).toBe(200);

    // Wait for response caching
    await new Promise((r) => setTimeout(r, 100));

    // Second request — should be cached
    const second = await httpPost(gatewayPort, '/v1/messages', requestBody, {
      'x-api-key': 'sk-test',
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-bastion-cache']).toBe('hit');
  });
});
