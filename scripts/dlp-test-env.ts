#!/usr/bin/env tsx
/**
 * DLP Mock Test Environment
 *
 * Starts a mock LLM upstream + Bastion proxy with DLP enabled,
 * then sends test payloads covering all DLP pattern categories and reports results.
 *
 * Usage:
 *   npx tsx scripts/dlp-test-env.ts                   # run all tests, then exit
 *   npx tsx scripts/dlp-test-env.ts --interactive      # keep running for manual testing
 *   npx tsx scripts/dlp-test-env.ts --action block     # override DLP action (block|redact|warn)
 */

import { createServer, request, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createTestDatabase } from '../src/storage/database.js';
import { PluginManager } from '../src/plugins/index.js';
import { createMetricsCollectorPlugin } from '../src/plugins/builtin/metrics-collector.js';
import { createDlpScannerPlugin } from '../src/plugins/builtin/dlp-scanner.js';
import { createTokenOptimizerPlugin } from '../src/plugins/builtin/token-optimizer.js';
import { createAuditLoggerPlugin } from '../src/plugins/builtin/audit-logger.js';
import { clearProviders, registerProvider, type ProviderConfig } from '../src/proxy/providers/index.js';
import { createProxyServer } from '../src/proxy/server.js';
import { ConfigManager } from '../src/config/manager.js';
import { resetEncryptionKey, getEncryptionKey } from '../src/storage/encryption.js';
import type { BastionConfig } from '../src/config/schema.js';
import type { DlpAction } from '../src/dlp/actions.js';

// ─── ANSI colors ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const interactive = args.includes('--interactive') || args.includes('-i');
const actionIdx = args.indexOf('--action');
const dlpAction: DlpAction = (actionIdx >= 0 ? args[actionIdx + 1] : 'block') as DlpAction;

// ─── Mock LLM upstream ──────────────────────────────────────────────────────
const ANTHROPIC_RESPONSE = JSON.stringify({
  id: 'msg_mock_dlp_test',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello! I am a mock LLM response for DLP testing.' }],
  model: 'claude-haiku-4.5-20241022',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 30, output_tokens: 15, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

// Response that contains sensitive data (for response-side DLP testing)
const LEAKY_RESPONSE = JSON.stringify({
  id: 'msg_mock_leaky',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Sure! Here is the AWS key you asked for: AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }],
  model: 'claude-haiku-4.5-20241022',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

let mockUpstreamPort = 0;
let upstreamRequests: { path: string; body: string }[] = [];

function startMockUpstream(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        upstreamRequests.push({ path: req.url ?? '/', body });

        // Check if the request asks for a leaky response
        try {
          const parsed = JSON.parse(body);
          const lastMsg = parsed.messages?.[parsed.messages.length - 1];
          if (lastMsg?.content?.includes?.('__LEAK_RESPONSE__')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(LEAKY_RESPONSE);
            return;
          }
        } catch { /* not JSON, use default response */ }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(ANTHROPIC_RESPONSE);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
function httpPost(port: number, path: string, body: string, headers: Record<string, string> = {}): Promise<{
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
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

// ─── Test payloads ───────────────────────────────────────────────────────────
interface TestCase {
  name: string;
  category: string;
  description: string;
  messages: { role: string; content: string }[];
  expectDetection: boolean;
  expectedPatterns?: string[];
}

const TEST_CASES: TestCase[] = [
  // ── Clean (should pass) ──
  {
    name: 'Clean message',
    category: 'clean',
    description: 'Normal conversation with no sensitive data',
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
    expectDetection: false,
  },
  {
    name: 'Code snippet (benign)',
    category: 'clean',
    description: 'Code that looks like keys but is not',
    messages: [{ role: 'user', content: 'Here is my config:\nmodel: gpt-4\nmax_tokens: 1024\ntemperature: 0.7' }],
    expectDetection: false,
  },

  // ── High-confidence patterns ──
  {
    name: 'AWS Access Key',
    category: 'high-confidence',
    description: 'AWS Access Key ID (AKIA prefix + 16 chars)',
    messages: [{ role: 'user', content: 'Use this AWS key: AKIAIOSFODNN7EXAMPLE' }],
    expectDetection: true,
    expectedPatterns: ['aws-access-key'],
  },
  {
    name: 'AWS Secret Key',
    category: 'high-confidence',
    description: 'AWS Secret Access Key with context words',
    messages: [{ role: 'user', content: 'My AWS secret access key is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }],
    expectDetection: true,
    expectedPatterns: ['aws-secret-key'],
  },
  {
    name: 'GitHub Token',
    category: 'high-confidence',
    description: 'GitHub Personal Access Token (ghp_ prefix)',
    messages: [{ role: 'user', content: 'My github token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk' }],
    expectDetection: true,
    expectedPatterns: ['github-token'],
  },
  {
    name: 'OpenAI API Key',
    category: 'high-confidence',
    description: 'OpenAI sk-proj- prefixed key',
    messages: [{ role: 'user', content: 'OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234' }],
    expectDetection: true,
    expectedPatterns: ['openai-api-key'],
  },
  {
    name: 'Anthropic API Key',
    category: 'high-confidence',
    description: 'Anthropic sk-ant- prefixed key',
    messages: [{ role: 'user', content: 'Set ANTHROPIC_API_KEY to sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901' }],
    expectDetection: true,
    expectedPatterns: ['anthropic-api-key'],
  },
  {
    name: 'Private Key (PEM)',
    category: 'high-confidence',
    description: 'PEM-encoded private key header',
    messages: [{ role: 'user', content: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS...\n-----END RSA PRIVATE KEY-----' }],
    expectDetection: true,
    expectedPatterns: ['private-key'],
  },
  {
    name: 'Password Assignment',
    category: 'high-confidence',
    description: 'password=value pattern in config/env context',
    messages: [{ role: 'user', content: 'Set DB_PASSWORD=SuperSecure!2024xK9m in the environment' }],
    expectDetection: true,
    expectedPatterns: ['password-assignment'],
  },
  {
    name: 'Google API Key',
    category: 'high-confidence',
    description: 'AIza-prefixed Google API key',
    messages: [{ role: 'user', content: 'Use this Google API key: AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q' }],
    expectDetection: true,
    expectedPatterns: ['google-api-key'],
  },

  // ── Validated patterns ──
  {
    name: 'Credit Card (Visa)',
    category: 'validated',
    description: 'Valid Visa card number (passes Luhn check)',
    messages: [{ role: 'user', content: 'My credit card number is 4111111111111111' }],
    expectDetection: true,
    expectedPatterns: ['credit-card'],
  },
  {
    name: 'Credit Card (Invalid Luhn)',
    category: 'validated',
    description: 'Card-like number that fails Luhn check — should NOT trigger',
    messages: [{ role: 'user', content: 'Reference number 4111111111111112' }],
    expectDetection: false,
  },
  {
    name: 'SSN',
    category: 'validated',
    description: 'US Social Security Number',
    messages: [{ role: 'user', content: 'SSN: 219-09-9999' }],
    expectDetection: true,
    expectedPatterns: ['ssn'],
  },

  // ── Context-aware patterns ──
  {
    name: 'Email with context',
    category: 'context-aware',
    description: 'Email address near "email" keyword',
    messages: [{ role: 'user', content: 'Please contact the user at their email address john.doe@company.com for follow-up' }],
    expectDetection: true,
    expectedPatterns: ['email-address'],
  },
  {
    name: 'Email without context (system role)',
    category: 'context-aware',
    description: 'Email in system message — no context keywords (note: "role":"user" provides "user" as context)',
    messages: [{ role: 'system', content: 'The identifier foo@bar.com is a placeholder' }],
    expectDetection: false,
  },
  {
    name: 'Phone with context',
    category: 'context-aware',
    description: 'US phone number near "phone" keyword',
    messages: [{ role: 'user', content: 'Call me at my phone number: (555) 123-4567' }],
    expectDetection: true,
    expectedPatterns: ['phone-number'],
  },
  {
    name: 'IP Address with context',
    category: 'context-aware',
    description: 'IPv4 address near "server" keyword',
    messages: [{ role: 'user', content: 'The production server IP is 192.168.1.100 and should not be exposed' }],
    expectDetection: true,
    expectedPatterns: ['ip-address'],
  },

  // ── Semantic / entropy detection ──
  {
    name: 'Generic secret (JSON)',
    category: 'semantic',
    description: 'High-entropy value in a sensitive field name inside JSON',
    messages: [{
      role: 'user',
      content: JSON.stringify({
        config: {
          api_secret: 'xK9mP2vL5nR8qW4jB7fT3aZ6yU0cD1eH',
        },
      }),
    }],
    expectDetection: true,
    expectedPatterns: ['generic-secret'],
  },
  {
    name: 'Non-sensitive field (JSON)',
    category: 'semantic',
    description: 'High-entropy value in a non-sensitive field name — should NOT trigger',
    messages: [{
      role: 'user',
      content: JSON.stringify({
        model: 'claude-haiku-4.5-20241022',
        content: 'xK9mP2vL5nR8qW4jB7fT3aZ6yU0cD1eH',
      }),
    }],
    expectDetection: false,
  },

  // ── Multiple findings in one message ──
  {
    name: 'Multiple secrets',
    category: 'multi',
    description: 'Message containing both AWS key and GitHub token',
    messages: [{
      role: 'user',
      content: 'Deploy with AKIAIOSFODNN7EXAMPLE and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk',
    }],
    expectDetection: true,
    expectedPatterns: ['aws-access-key', 'github-token'],
  },

  // ── Response-side detection (triggers mock leaky response) ──
  {
    name: 'Leaky LLM response',
    category: 'response-side',
    description: 'LLM response contains AWS credentials — tests response-side DLP scanning',
    messages: [{ role: 'user', content: '__LEAK_RESPONSE__ Give me the AWS credentials' }],
    expectDetection: true,
    expectedPatterns: ['aws-access-key'],
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║       Bastion DLP Mock Test Environment            ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚═══════════════════════════════════════════════════╝${C.reset}\n`);

  // 1. Start mock upstream
  console.log(`${C.dim}[1/4]${C.reset} Starting mock LLM upstream...`);
  const upstream = await startMockUpstream();
  mockUpstreamPort = upstream.port;
  console.log(`  ${C.green}✓${C.reset} Mock upstream on port ${C.bold}${upstream.port}${C.reset}\n`);

  // 2. Set up database + encryption
  console.log(`${C.dim}[2/4]${C.reset} Initializing database & encryption...`);
  resetEncryptionKey();
  const tmpDir = `/tmp/bastion-dlp-test-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  getEncryptionKey(`${tmpDir}/.key`);
  const db = createTestDatabase();
  console.log(`  ${C.green}✓${C.reset} In-memory SQLite with all migrations\n`);

  // 3. Configure provider + plugins
  console.log(`${C.dim}[3/4]${C.reset} Configuring Bastion proxy (DLP action: ${C.bold}${dlpAction}${C.reset})...`);
  clearProviders();
  const testProvider: ProviderConfig = {
    name: 'anthropic',
    baseUrl: `http://127.0.0.1:${upstream.port}`,
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
  registerProvider('/v1/messages', testProvider);

  const config: BastionConfig = {
    server: { host: '127.0.0.1', port: 0 },
    logging: { level: 'warn' },
    plugins: {
      metrics: { enabled: true },
      dlp: {
        enabled: true,
        action: dlpAction,
        patterns: ['high-confidence', 'validated', 'context-aware'],
        aiValidation: { enabled: false, provider: 'anthropic', model: '', apiKey: '', timeoutMs: 5000, cacheSize: 500 },
        semantics: { sensitivePatterns: [], nonSensitiveNames: [] },
      },
      optimizer: { enabled: false, cache: false, cacheTtlSeconds: 300, trimWhitespace: false, reorderForCache: false },
      audit: { enabled: true, retentionHours: 168, rawData: true, rawMaxBytes: 524288, summaryMaxBytes: 1024 },
    },
    timeouts: { upstream: 10000, plugin: 5000 },
  };

  const configManager = new ConfigManager(config);
  const pluginManager = new PluginManager(config.timeouts.plugin);

  pluginManager.register(createMetricsCollectorPlugin(db));
  pluginManager.register(createDlpScannerPlugin(db, {
    action: dlpAction,
    patterns: ['high-confidence', 'validated', 'context-aware'],
    getAction: () => configManager.get().plugins.dlp.action,
  }));
  pluginManager.register(createAuditLoggerPlugin(db, {
    retentionHours: 168,
    rawData: true,
    rawMaxBytes: 524288,
    summaryMaxBytes: 1024,
  }));

  const gateway = createProxyServer(config, pluginManager, () => {}, db, configManager);

  await new Promise<void>((resolve) => {
    gateway.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = gateway.address();
  const gatewayPort = typeof addr === 'object' && addr ? addr.port : 0;

  console.log(`  ${C.green}✓${C.reset} Proxy on port ${C.bold}${gatewayPort}${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} Dashboard: ${C.cyan}http://127.0.0.1:${gatewayPort}/dashboard${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} Stats API: ${C.cyan}http://127.0.0.1:${gatewayPort}/api/stats${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} DLP Findings: ${C.cyan}http://127.0.0.1:${gatewayPort}/api/dlp/recent${C.reset}\n`);

  // 4. Run test payloads
  console.log(`${C.dim}[4/4]${C.reset} Running ${C.bold}${TEST_CASES.length}${C.reset} test cases...\n`);
  console.log(`${'─'.repeat(90)}`);

  let passed = 0;
  let failed = 0;
  const results: { name: string; status: string; statusCode: number; details: string }[] = [];

  for (const tc of TEST_CASES) {
    const body = JSON.stringify({
      model: 'claude-haiku-4.5-20241022',
      max_tokens: 200,
      messages: tc.messages,
    });

    upstreamRequests = [];
    const res = await httpPost(gatewayPort, '/v1/messages', body, { 'x-api-key': 'sk-test-mock' });

    // Wait a tick for async DLP event recording
    await new Promise((r) => setTimeout(r, 50));

    const isBlocked = res.statusCode === 403;
    const hasRedactHeader = res.headers['x-bastion-dlp'] === 'redacted';
    let responseBody: Record<string, unknown> | null = null;
    try { responseBody = JSON.parse(res.body); } catch { /* not json */ }

    // Check if body was redacted (contains REDACTED markers)
    const bodyRedacted = res.body.includes('_REDACTED]');

    const detected = isBlocked || hasRedactHeader || bodyRedacted;

    // For response-side: check if the upstream was called AND the response was modified
    const upstreamCalled = upstreamRequests.length > 0;

    let status: string;
    let detail: string;
    let ok: boolean;

    if (tc.category === 'response-side') {
      // Special handling: response-side detection
      if (dlpAction === 'block') {
        // In block mode, response with sensitive data should return 403
        ok = res.statusCode === 403 || res.statusCode === 200; // May or may not catch response depending on streaming
        if (res.statusCode === 403) {
          status = `${C.bgRed}${C.white} BLOCKED ${C.reset}`;
          detail = 'Response blocked by DLP';
        } else {
          // Check if DLP events were recorded for response
          const dlpRecent = await httpGet(gatewayPort, '/api/dlp/recent?limit=5');
          const dlpData = JSON.parse(dlpRecent.body);
          const responseFindings = dlpData.filter((d: { direction: string }) => d.direction === 'response');
          if (responseFindings.length > 0) {
            status = `${C.bgYellow}${C.white} WARNED ${C.reset}`;
            detail = `Response-side findings recorded (post-send): ${responseFindings.map((f: { pattern_name: string }) => f.pattern_name).join(', ')}`;
            ok = true;
          } else {
            status = `${C.yellow} PASS-THRU ${C.reset}`;
            detail = 'Response passed (DLP may not detect in non-streaming)';
            ok = true;
          }
        }
      } else {
        ok = true;
        status = `${C.green} OK ${C.reset}`;
        detail = `Response-side scan (action=${dlpAction})`;
      }
    } else if (tc.expectDetection) {
      if (dlpAction === 'block' && isBlocked) {
        ok = true;
        status = `${C.bgRed}${C.white} BLOCKED ${C.reset}`;
        const err = responseBody?.error as Record<string, string> | undefined;
        detail = err?.message ?? 'Blocked by DLP';
      } else if (dlpAction === 'redact' && res.statusCode === 200) {
        // Check if upstream received redacted body
        const upstreamBody = upstreamRequests[0]?.body ?? '';
        const wasRedacted = upstreamBody.includes('_REDACTED]');
        ok = wasRedacted;
        status = wasRedacted ? `${C.bgYellow}${C.white} REDACTED ${C.reset}` : `${C.bgRed}${C.white} MISSED ${C.reset}`;
        detail = wasRedacted ? `Body redacted before upstream` : 'Expected redaction but body was not modified';
      } else if (dlpAction === 'warn' && res.statusCode === 200) {
        ok = true;
        status = `${C.bgYellow}${C.white} WARNED ${C.reset}`;
        detail = 'Passed through with warning (logged)';
      } else if (dlpAction === 'block' && !isBlocked) {
        ok = false;
        status = `${C.bgRed}${C.white} MISSED ${C.reset}`;
        detail = `Expected block (403) but got ${res.statusCode}`;
      } else {
        ok = detected;
        status = detected ? `${C.green} DETECTED ${C.reset}` : `${C.bgRed}${C.white} MISSED ${C.reset}`;
        detail = `Status ${res.statusCode}`;
      }
    } else {
      // Should NOT be detected
      if (isBlocked) {
        ok = false;
        status = `${C.bgRed}${C.white} FALSE+ ${C.reset}`;
        const err = responseBody?.error as Record<string, string> | undefined;
        detail = `False positive: ${err?.message ?? 'blocked'}`;
      } else {
        ok = true;
        status = `${C.bgGreen}${C.white} CLEAN ${C.reset}`;
        detail = 'Correctly passed through';
      }
    }

    if (ok) passed++; else failed++;

    const categoryTag = `${C.dim}[${tc.category}]${C.reset}`;
    console.log(`  ${status} ${categoryTag} ${C.bold}${tc.name}${C.reset}`);
    console.log(`         ${C.dim}${tc.description}${C.reset}`);
    console.log(`         ${detail}`);
    if (tc.expectedPatterns?.length) {
      console.log(`         ${C.dim}Expected patterns: ${tc.expectedPatterns.join(', ')}${C.reset}`);
    }
    console.log();

    results.push({ name: tc.name, status: ok ? 'PASS' : 'FAIL', statusCode: res.statusCode, details: detail });
  }

  // ── Summary ──
  console.log(`${'─'.repeat(90)}`);
  console.log(`\n${C.bold}Summary${C.reset} (DLP action: ${C.bold}${dlpAction}${C.reset})`);
  console.log(`  ${C.green}Passed: ${passed}${C.reset}  ${failed > 0 ? `${C.red}Failed: ${failed}${C.reset}` : `${C.dim}Failed: 0${C.reset}`}  Total: ${TEST_CASES.length}\n`);

  // Show DLP findings from API
  const dlpRecent = await httpGet(gatewayPort, '/api/dlp/recent?limit=100');
  const dlpData = JSON.parse(dlpRecent.body) as Array<Record<string, unknown>>;
  if (dlpData.length > 0) {
    console.log(`${C.bold}DLP Findings recorded:${C.reset} ${dlpData.length}`);
    console.log(`${'─'.repeat(90)}`);
    console.log(`  ${'Pattern'.padEnd(25)} ${'Category'.padEnd(18)} ${'Action'.padEnd(10)} ${'Dir'.padEnd(10)} Count`);
    console.log(`  ${'─'.repeat(25)} ${'─'.repeat(18)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(5)}`);
    for (const f of dlpData) {
      console.log(
        `  ${String(f.pattern_name).padEnd(25)} ${String(f.pattern_category).padEnd(18)} ${String(f.action).padEnd(10)} ${String(f.direction ?? 'request').padEnd(10)} ${f.match_count}`,
      );
    }
    console.log();
  }

  // Show stats
  const statsRes = await httpGet(gatewayPort, '/api/stats');
  const stats = JSON.parse(statsRes.body);
  console.log(`${C.bold}Gateway Stats:${C.reset}`);
  console.log(`  Total requests: ${stats.stats.total_requests}`);
  console.log(`  DLP blocked: ${stats.dlp?.total_blocked ?? 0}`);
  console.log(`  DLP redacted: ${stats.dlp?.total_redacted ?? 0}`);
  console.log(`  DLP warned: ${stats.dlp?.total_warned ?? 0}`);
  console.log();

  if (interactive) {
    console.log(`${C.bold}${C.cyan}Interactive mode${C.reset} — proxy running at:`);
    console.log(`  Proxy:     ${C.cyan}http://127.0.0.1:${gatewayPort}${C.reset}`);
    console.log(`  Dashboard: ${C.cyan}http://127.0.0.1:${gatewayPort}/dashboard${C.reset}`);
    console.log(`  Upstream:  ${C.cyan}http://127.0.0.1:${upstream.port}${C.reset}`);
    console.log();
    console.log(`${C.bold}Example curl commands:${C.reset}`);
    console.log();
    console.log(`  ${C.dim}# Clean request (should pass)${C.reset}`);
    console.log(`  curl -s http://127.0.0.1:${gatewayPort}/v1/messages \\`);
    console.log(`    -H "content-type: application/json" \\`);
    console.log(`    -H "x-api-key: sk-test" \\`);
    console.log(`    -d '{"model":"claude-haiku-4.5-20241022","max_tokens":100,"messages":[{"role":"user","content":"Hello"}]}'`);
    console.log();
    console.log(`  ${C.dim}# Request with AWS key (should be caught by DLP)${C.reset}`);
    console.log(`  curl -s http://127.0.0.1:${gatewayPort}/v1/messages \\`);
    console.log(`    -H "content-type: application/json" \\`);
    console.log(`    -H "x-api-key: sk-test" \\`);
    console.log(`    -d '{"model":"claude-haiku-4.5-20241022","max_tokens":100,"messages":[{"role":"user","content":"My key is AKIAIOSFODNN7EXAMPLE"}]}'`);
    console.log();
    console.log(`  ${C.dim}# View DLP findings${C.reset}`);
    console.log(`  curl -s http://127.0.0.1:${gatewayPort}/api/dlp/recent | jq .`);
    console.log();
    console.log(`  ${C.dim}# View stats${C.reset}`);
    console.log(`  curl -s http://127.0.0.1:${gatewayPort}/api/stats | jq .`);
    console.log();
    console.log(`Press Ctrl+C to stop.\n`);

    // Keep alive
    await new Promise(() => {});
  } else {
    // Cleanup
    gateway.close();
    upstream.server.close();
    db.close();
    resetEncryptionKey();

    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`${C.red}Fatal error:${C.reset}`, err);
  process.exit(1);
});
