import { describe, it, expect, afterEach } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { RequestsRepository } from '../../../src/storage/repositories/requests.js';
import { DlpEventsRepository } from '../../../src/storage/repositories/dlp-events.js';
import { OptimizerEventsRepository } from '../../../src/storage/repositories/optimizer-events.js';
import { SessionsRepository } from '../../../src/storage/repositories/sessions.js';
import { AuditLogRepository } from '../../../src/storage/repositories/audit-log.js';
import { ToolCallsRepository } from '../../../src/storage/repositories/tool-calls.js';
import type Database from 'better-sqlite3';

function insertAt(db: Database.Database, table: string, id: string, hoursAgo: number): void {
  db.prepare(
    `UPDATE ${table} SET created_at = datetime('now', '-' || ? || ' hours') WHERE id = ?`
  ).run(hoursAgo, id);
}

describe('Data Retention', () => {
  let db: ReturnType<typeof createTestDatabase>;

  afterEach(() => {
    if (db) db.close();
  });

  describe('RequestsRepository', () => {
    it('purgeOlderThan removes old records', () => {
      db = createTestDatabase();
      const repo = new RequestsRepository(db);

      repo.insert({ id: 'r1', provider: 'anthropic', model: 'm', method: 'POST', path: '/', status_code: 200, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0, cached: 0, dlp_action: null, dlp_findings: 0, session_id: null, api_key_hash: null });
      repo.insert({ id: 'r2', provider: 'anthropic', model: 'm', method: 'POST', path: '/', status_code: 200, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0, cached: 0, dlp_action: null, dlp_findings: 0, session_id: null, api_key_hash: null });

      // Make r1 48 hours old
      insertAt(db, 'requests', 'r1', 48);

      const purged = repo.purgeOlderThan(24);
      expect(purged).toBe(1);
      expect(repo.getRecent(10)).toHaveLength(1);
      expect(repo.getRecent(10)[0].id).toBe('r2');
    });

    it('getRecent with since filters by time', () => {
      db = createTestDatabase();
      const repo = new RequestsRepository(db);

      repo.insert({ id: 'r1', provider: 'anthropic', model: 'm', method: 'POST', path: '/', status_code: 200, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0, cached: 0, dlp_action: null, dlp_findings: 0, session_id: null, api_key_hash: null });
      repo.insert({ id: 'r2', provider: 'anthropic', model: 'm', method: 'POST', path: '/', status_code: 200, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0, cached: 0, dlp_action: null, dlp_findings: 0, session_id: null, api_key_hash: null });

      insertAt(db, 'requests', 'r1', 48);

      const since = new Date(Date.now() - 24 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
      const recent = repo.getRecent(10, since);
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe('r2');
    });
  });

  describe('DlpEventsRepository', () => {
    it('purgeOlderThan removes old records', () => {
      db = createTestDatabase();
      const repo = new DlpEventsRepository(db);

      repo.insert({ id: 'd1', request_id: 'r1', pattern_name: 'test', pattern_category: 'high-confidence', action: 'warn', match_count: 1, original_snippet: null, redacted_snippet: null });
      repo.insert({ id: 'd2', request_id: 'r2', pattern_name: 'test', pattern_category: 'high-confidence', action: 'warn', match_count: 1, original_snippet: null, redacted_snippet: null });

      insertAt(db, 'dlp_events', 'd1', 48);

      const purged = repo.purgeOlderThan(24);
      expect(purged).toBe(1);
      expect(repo.getRecent(10)).toHaveLength(1);
    });
  });

  describe('OptimizerEventsRepository', () => {
    it('purgeOlderThan removes old records', () => {
      db = createTestDatabase();
      const repo = new OptimizerEventsRepository(db);

      repo.insert({ id: 'o1', request_id: 'r1', cache_hit: 0, original_length: 100, trimmed_length: 90, chars_saved: 10, tokens_saved_estimate: 3 });
      repo.insert({ id: 'o2', request_id: 'r2', cache_hit: 1, original_length: 200, trimmed_length: 200, chars_saved: 0, tokens_saved_estimate: 0 });

      insertAt(db, 'optimizer_events', 'o1', 48);

      const purged = repo.purgeOlderThan(24);
      expect(purged).toBe(1);
      expect(repo.getRecent(10)).toHaveLength(1);
    });

    it('getRecent with since filters by time', () => {
      db = createTestDatabase();
      const repo = new OptimizerEventsRepository(db);

      repo.insert({ id: 'o1', request_id: 'r1', cache_hit: 0, original_length: 100, trimmed_length: 90, chars_saved: 10, tokens_saved_estimate: 3 });
      repo.insert({ id: 'o2', request_id: 'r2', cache_hit: 1, original_length: 200, trimmed_length: 200, chars_saved: 0, tokens_saved_estimate: 0 });

      insertAt(db, 'optimizer_events', 'o1', 48);

      const since = new Date(Date.now() - 24 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
      const recent = repo.getRecent(10, since);
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe('o2');
    });
  });

  describe('SessionsRepository', () => {
    it('purgeOlderThan removes old sessions', () => {
      db = createTestDatabase();
      const repo = new SessionsRepository(db);

      repo.upsert('s1', { source: 'test' });
      repo.upsert('s2', { source: 'test' });

      // Make s1 old via last_seen_at
      db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-48 hours') WHERE id = 's1'`).run();

      const purged = repo.purgeOlderThan(24);
      expect(purged).toBe(1);
      expect(repo.getAll()).toHaveLength(1);
      expect(repo.getAll()[0].id).toBe('s2');
    });
  });

  describe('AuditLogRepository', () => {
    it('getRecent with since filters by time', () => {
      db = createTestDatabase();
      const repo = new AuditLogRepository(db);

      repo.insert({ id: 'a1', request_id: 'r1', requestBody: '{}', responseBody: '{}', rawData: false });
      repo.insert({ id: 'a2', request_id: 'r2', requestBody: '{}', responseBody: '{}', rawData: false });

      insertAt(db, 'audit_log', 'a1', 48);

      const since = new Date(Date.now() - 24 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
      const recent = repo.getRecent(10, since);
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe('a2');
    });

    it('purgeOlderThan removes old records', () => {
      db = createTestDatabase();
      const repo = new AuditLogRepository(db);

      repo.insert({ id: 'a1', request_id: 'r1', requestBody: '{}', responseBody: '{}', rawData: false });
      repo.insert({ id: 'a2', request_id: 'r2', requestBody: '{}', responseBody: '{}', rawData: false });

      insertAt(db, 'audit_log', 'a1', 48);

      const purged = repo.purgeOlderThan(24);
      expect(purged).toBe(1);
      expect(repo.getRecent(10)).toHaveLength(1);
    });
  });

  describe('ToolCallsRepository', () => {
    it('getRecent with since filters by time', () => {
      db = createTestDatabase();
      const repo = new ToolCallsRepository(db);

      repo.insert({ id: 't1', request_id: 'r1', tool_name: 'bash', tool_input: 'ls', rule_id: null, rule_name: null, severity: null, category: null, provider: 'anthropic', session_id: null });
      repo.insert({ id: 't2', request_id: 'r2', tool_name: 'bash', tool_input: 'pwd', rule_id: null, rule_name: null, severity: null, category: null, provider: 'anthropic', session_id: null });

      insertAt(db, 'tool_calls', 't1', 48);

      const since = new Date(Date.now() - 24 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
      const recent = repo.getRecent(10, since);
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe('t2');
    });

    it('purgeOlderThan removes old records', () => {
      db = createTestDatabase();
      const repo = new ToolCallsRepository(db);

      repo.insert({ id: 't1', request_id: 'r1', tool_name: 'bash', tool_input: 'ls', rule_id: null, rule_name: null, severity: null, category: null, provider: 'anthropic', session_id: null });
      repo.insert({ id: 't2', request_id: 'r2', tool_name: 'bash', tool_input: 'pwd', rule_id: null, rule_name: null, severity: null, category: null, provider: 'anthropic', session_id: null });

      insertAt(db, 'tool_calls', 't1', 48);

      const purged = repo.purgeOlderThan(24);
      expect(purged).toBe(1);
      expect(repo.getRecent(10)).toHaveLength(1);
    });
  });
});
