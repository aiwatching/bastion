/**
 * Test threat-scorer plugin: scoring, decay, thresholds, level transitions,
 * and integration with tool-guard via context._threatLevel.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { createThreatScorerPlugin } from '../../../src/plugins/builtin/threat-scorer.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { ThreatScoresRepository } from '../../../src/storage/repositories/threat-scores.js';
import { ThreatScoreEventsRepository } from '../../../src/storage/repositories/threat-score-events.js';
import { ToolChainDetectionsRepository } from '../../../src/storage/repositories/tool-chain-detections.js';
import { resetEncryptionKey, getEncryptionKey } from '../../../src/storage/encryption.js';
import { mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { BastionConfig } from '../../../src/config/schema.js';
import type { RequestContext } from '../../../src/plugins/types.js';

function makeConfig(overrides?: Partial<BastionConfig['plugins']['threatIntelligence']>): BastionConfig {
  return {
    server: { host: '0.0.0.0', port: 9800, failMode: 'open', auth: { enabled: false, token: '', excludePaths: [] } },
    logging: { level: 'warn' },
    plugins: {
      metrics: { enabled: false },
      dlp: { enabled: false, action: 'warn', patterns: [], remotePatterns: { url: '', branch: '', syncOnStart: false, syncIntervalMinutes: 0 }, aiValidation: { enabled: false, provider: 'anthropic', model: '', apiKey: '', timeoutMs: 0, cacheSize: 0 }, semantics: { sensitivePatterns: [], nonSensitiveNames: [] } },
      optimizer: { enabled: false, cache: false, cacheTtlSeconds: 0, trimWhitespace: false, reorderForCache: false },
      audit: { enabled: false, rawData: false, rawMaxBytes: 0, summaryMaxBytes: 0 },
      toolGuard: { enabled: false, action: 'audit', recordAll: false, blockMinSeverity: 'critical', alertMinSeverity: 'high', alertDesktop: false, alertWebhookUrl: '' },
      threatIntelligence: {
        enabled: true,
        scoring: {
          piWeight: 30,
          dlpWeight: 10,
          toolGuardWeights: { critical: 25, high: 15, medium: 5, low: 2 },
          toolChainWeight: 40,
          decayPerMinute: 0, // disable decay for deterministic tests
        },
        thresholds: { elevated: 20, high: 50, critical: 80 },
        toolChain: { enabled: true, maxWindowSize: 20 },
        taintTracking: { enabled: true, ttlMinutes: 60 },
        ...overrides,
      },
    },
    retention: { requestsHours: 720, dlpEventsHours: 720, toolCallsHours: 720, optimizerEventsHours: 720, sessionsHours: 720, auditLogHours: 720, pluginEventsHours: 720 },
    timeouts: { upstream: 30000, plugin: 5000 },
  } as BastionConfig;
}

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

describe('Threat Scorer Plugin', () => {
  let db: Database.Database;
  let eventBus: PluginEventBus;
  let scoresRepo: ThreatScoresRepository;
  let eventsRepo: ThreatScoreEventsRepository;

  beforeAll(() => {
    resetEncryptionKey();
    const tmpDir = `/tmp/bastion-threat-scorer-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    getEncryptionKey(`${tmpDir}/.key`);
  });

  beforeEach(() => {
    db = createTestDatabase();
    eventBus = new PluginEventBus();
    scoresRepo = new ThreatScoresRepository(db);
    eventsRepo = new ThreatScoreEventsRepository(db);
  });

  afterAll(() => {
    resetEncryptionKey();
  });

  it('starts with normal threat level', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);
    const ctx = makeRequestContext('s1');
    await plugin.onRequest!(ctx);
    expect(ctx._threatLevel).toBe('normal');
    expect(ctx._threatScore).toBe(0);
  });

  it('pi:detected adds 30 points', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });

    const ctx = makeRequestContext('s1');
    await plugin.onRequest!(ctx);
    expect(ctx._threatScore).toBe(30);
    expect(ctx._threatLevel).toBe('elevated'); // 30 >= 20
  });

  it('dlp:finding adds 10 points', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    eventBus.emit('dlp:finding', { sessionId: 's1', requestId: 'r1', patternName: 'aws-key', direction: 'request' });

    const ctx = makeRequestContext('s1');
    await plugin.onRequest!(ctx);
    expect(ctx._threatScore).toBe(10);
    expect(ctx._threatLevel).toBe('normal'); // 10 < 20
  });

  it('toolguard:alert adds points by severity', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    eventBus.emit('toolguard:alert', { sessionId: 's1', severity: 'critical', category: 'destructive-fs', ruleName: 'rm-rf' });

    const ctx = makeRequestContext('s1');
    await plugin.onRequest!(ctx);
    expect(ctx._threatScore).toBe(25); // critical weight
    expect(ctx._threatLevel).toBe('elevated'); // 25 >= 20
  });

  it('accumulates to high level', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    // PI: +30 → elevated
    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });
    // DLP: +10 → 40, still elevated
    eventBus.emit('dlp:finding', { sessionId: 's1', requestId: 'r1', patternName: 'test' });
    // DLP: +10 → 50, high
    eventBus.emit('dlp:finding', { sessionId: 's1', requestId: 'r2', patternName: 'test2' });

    const ctx = makeRequestContext('s1');
    await plugin.onRequest!(ctx);
    expect(ctx._threatScore).toBe(50);
    expect(ctx._threatLevel).toBe('high');
  });

  it('accumulates to critical level', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    // PI: +30
    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });
    // PI: +30 → 60
    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });
    // ToolGuard critical: +25 → 85
    eventBus.emit('toolguard:alert', { sessionId: 's1', severity: 'critical', category: 'destructive-fs', ruleName: 'rm-rf' });

    const ctx = makeRequestContext('s1');
    await plugin.onRequest!(ctx);
    expect(ctx._threatScore).toBe(85);
    expect(ctx._threatLevel).toBe('critical');
  });

  it('persists scores to database', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });

    // Check DB
    const record = scoresRepo.get('s1');
    expect(record).not.toBeNull();
    expect(record!.score).toBe(30);
    expect(record!.level).toBe('elevated');
    expect(record!.event_count).toBe(1);
  });

  it('persists score events to database', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });
    eventBus.emit('dlp:finding', { sessionId: 's1', requestId: 'r1', patternName: 'aws-key' });

    const events = eventsRepo.getBySession('s1');
    expect(events).toHaveLength(2);
    // Events are emitted synchronously, both at same datetime('now') — order may vary
    const types = events.map(e => e.event_type).sort();
    expect(types).toEqual(['dlp', 'pi']);
  });

  it('isolates sessions', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });

    const ctx1 = makeRequestContext('s1');
    await plugin.onRequest!(ctx1);
    expect(ctx1._threatLevel).toBe('elevated');

    const ctx2 = makeRequestContext('s2');
    await plugin.onRequest!(ctx2);
    expect(ctx2._threatLevel).toBe('normal');
    expect(ctx2._threatScore).toBe(0);
  });

  it('ignores events without sessionId', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    eventBus.emit('pi:detected', { severity: 'high' }); // no sessionId
    eventBus.emit('dlp:finding', { requestId: 'r1', patternName: 'test' }); // no sessionId

    const records = scoresRepo.getAll();
    expect(records).toHaveLength(0);
  });

  it('skips threat level for requests without sessionId', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    const ctx: RequestContext = {
      id: crypto.randomUUID(),
      provider: 'anthropic',
      model: 'test',
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: '{}',
      parsedBody: {},
      isStreaming: false,
      startTime: Date.now(),
      // no sessionId
    };
    await plugin.onRequest!(ctx);
    expect(ctx._threatLevel).toBeUndefined();
  });

  it('tool chain detection triggers on category sequence', async () => {
    const chainRepo = new ToolChainDetectionsRepository(db);
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    // Emit toolguard alerts with categories that form a chain
    eventBus.emit('toolguard:alert', {
      sessionId: 's1', severity: 'high', category: 'credential-access', ruleName: 'cred-env-read',
    });
    eventBus.emit('toolguard:alert', {
      sessionId: 's1', severity: 'medium', category: 'network-exfil', ruleName: 'net-curl-post',
    });

    // Points: credential-access (high=15) + network-exfil (medium=5) + chain (40) = 60
    const ctx = makeRequestContext('s1');
    await plugin.onRequest!(ctx);
    expect(ctx._threatScore).toBe(60);
    expect(ctx._threatLevel).toBe('high');

    // Chain detection should be persisted
    const detections = chainRepo.getBySession('s1');
    expect(detections).toHaveLength(1);
    expect(detections[0].rule_id).toBe('chain-exfil-after-cred');
  });

  it('emits threat:level-change event', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    const received: unknown[] = [];
    eventBus.on('threat:level-change', (data) => received.push(data));

    eventBus.emit('pi:detected', { sessionId: 's1', severity: 'high' });

    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).level).toBe('elevated');
  });

  it('emits toolchain:detected event', async () => {
    const plugin = createThreatScorerPlugin(makeConfig(), db, eventBus);

    const received: unknown[] = [];
    eventBus.on('toolchain:detected', (data) => received.push(data));

    eventBus.emit('toolguard:alert', { sessionId: 's1', severity: 'high', category: 'credential-access', ruleName: 'cred' });
    eventBus.emit('toolguard:alert', { sessionId: 's1', severity: 'medium', category: 'network-exfil', ruleName: 'exfil' });

    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).ruleId).toBe('chain-exfil-after-cred');
  });
});
