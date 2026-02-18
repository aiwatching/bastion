import { describe, it, expect, afterEach } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { RequestsRepository } from '../../../src/storage/repositories/requests.js';
import { CacheRepository } from '../../../src/storage/repositories/cache.js';
import { DlpEventsRepository } from '../../../src/storage/repositories/dlp-events.js';

describe('Storage Layer', () => {
  let db: ReturnType<typeof createTestDatabase>;

  afterEach(() => {
    if (db) db.close();
  });

  it('creates all tables via migrations', () => {
    db = createTestDatabase();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('requests');
    expect(names).toContain('cache');
    expect(names).toContain('dlp_events');
    expect(names).toContain('schema_version');
  });

  describe('RequestsRepository', () => {
    it('inserts and retrieves requests', () => {
      db = createTestDatabase();
      const repo = new RequestsRepository(db);

      repo.insert({
        id: 'req-1',
        provider: 'anthropic',
        model: 'claude-haiku-4.5-20241022',
        method: 'POST',
        path: '/v1/messages',
        status_code: 200,
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0.001,
        latency_ms: 500,
        cached: 0,
        dlp_action: null,
        dlp_findings: 0,
        session_id: null,
        api_key_hash: null,
      });

      const recent = repo.getRecent(1);
      expect(recent).toHaveLength(1);
      expect(recent[0].provider).toBe('anthropic');
    });

    it('computes stats correctly', () => {
      db = createTestDatabase();
      const repo = new RequestsRepository(db);

      repo.insert({
        id: 'req-1', provider: 'anthropic', model: 'claude-haiku-4.5-20241022',
        method: 'POST', path: '/v1/messages', status_code: 200,
        input_tokens: 100, output_tokens: 50, cache_creation_tokens: 0, cache_read_tokens: 0,
        cost_usd: 0.001, latency_ms: 500, cached: 0, dlp_action: null, dlp_findings: 0,
        session_id: null, api_key_hash: null,
      });
      repo.insert({
        id: 'req-2', provider: 'openai', model: 'gpt-4o',
        method: 'POST', path: '/v1/chat/completions', status_code: 200,
        input_tokens: 200, output_tokens: 100, cache_creation_tokens: 0, cache_read_tokens: 0,
        cost_usd: 0.005, latency_ms: 800, cached: 1, dlp_action: null, dlp_findings: 0,
        session_id: null, api_key_hash: null,
      });

      const stats = repo.getStats();
      expect(stats.total_requests).toBe(2);
      expect(stats.total_cost_usd).toBeCloseTo(0.006);
      expect(stats.cache_hits).toBe(1);
      expect(stats.by_provider['anthropic'].requests).toBe(1);
      expect(stats.by_provider['openai'].requests).toBe(1);
    });
  });

  describe('CacheRepository', () => {
    it('stores and retrieves cache entries', () => {
      db = createTestDatabase();
      const repo = new CacheRepository(db);

      repo.set({
        key: 'abc123',
        provider: 'anthropic',
        model: 'claude-haiku-4.5-20241022',
        encrypted_response: Buffer.from('encrypted'),
        iv: Buffer.from('ivdata123456'),
        auth_tag: Buffer.from('authtag1234abcde'),
        input_tokens: 100,
        output_tokens: 50,
      });

      const entry = repo.get('abc123');
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe('anthropic');
      expect(entry!.hit_count).toBe(1);
    });

    it('increments hit_count on repeated gets', () => {
      db = createTestDatabase();
      const repo = new CacheRepository(db);

      repo.set({
        key: 'abc123',
        provider: 'anthropic',
        model: 'claude-haiku-4.5-20241022',
        encrypted_response: Buffer.from('encrypted'),
        iv: Buffer.from('ivdata123456'),
        auth_tag: Buffer.from('authtag1234abcde'),
        input_tokens: 100,
        output_tokens: 50,
      });

      repo.get('abc123');
      repo.get('abc123');
      const entry = repo.get('abc123');
      expect(entry!.hit_count).toBe(3);
    });
  });

  describe('DlpEventsRepository', () => {
    it('inserts and retrieves DLP events', () => {
      db = createTestDatabase();
      const reqRepo = new RequestsRepository(db);
      const dlpRepo = new DlpEventsRepository(db);

      reqRepo.insert({
        id: 'req-1', provider: 'anthropic', model: 'claude-haiku-4.5-20241022',
        method: 'POST', path: '/v1/messages', status_code: 200,
        input_tokens: 100, output_tokens: 50, cache_creation_tokens: 0, cache_read_tokens: 0,
        cost_usd: 0.001, latency_ms: 500, cached: 0, dlp_action: 'warn', dlp_findings: 1,
        session_id: null, api_key_hash: null,
      });

      dlpRepo.insert({
        id: 'dlp-1',
        request_id: 'req-1',
        pattern_name: 'credit-card',
        pattern_category: 'high-confidence',
        action: 'warn',
        match_count: 1,
        original_snippet: null,
        redacted_snippet: null,
      });

      const events = dlpRepo.getByRequestId('req-1');
      expect(events).toHaveLength(1);
      expect(events[0].pattern_name).toBe('credit-card');
    });
  });
});
