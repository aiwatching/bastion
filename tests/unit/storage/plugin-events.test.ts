import { describe, it, expect, afterEach } from 'vitest';
import { PluginEventsRepository } from '../../../src/storage/repositories/plugin-events.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import type Database from 'better-sqlite3';

function insertAt(db: Database.Database, id: string, hoursAgo: number): void {
  db.prepare(
    `UPDATE plugin_events SET created_at = datetime('now', '-' || ? || ' hours') WHERE id = ?`
  ).run(hoursAgo, id);
}

describe('PluginEventsRepository', () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  it('insert + getRecent', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);

    repo.insert({
      id: 'pe1',
      plugin_name: 'my-plugin',
      request_id: 'req-1',
      type: 'custom',
      severity: 'info',
      rule: 'test-rule',
      detail: 'found something',
      matched_text: null,
    });

    const records = repo.getRecent(10);
    expect(records).toHaveLength(1);
    expect(records[0].plugin_name).toBe('my-plugin');
    expect(records[0].rule).toBe('test-rule');
  });

  it('getByPlugin filters by plugin name', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);

    repo.insert({ id: 'pe1', plugin_name: 'alpha', request_id: null, type: 'custom', severity: 'info', rule: 'r1', detail: 'd1', matched_text: null });
    repo.insert({ id: 'pe2', plugin_name: 'beta', request_id: null, type: 'custom', severity: 'info', rule: 'r2', detail: 'd2', matched_text: null });

    const alpha = repo.getByPlugin('alpha');
    expect(alpha).toHaveLength(1);
    expect(alpha[0].id).toBe('pe1');

    const beta = repo.getByPlugin('beta');
    expect(beta).toHaveLength(1);
    expect(beta[0].id).toBe('pe2');
  });

  it('purgeOlderThan removes old records', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);

    repo.insert({ id: 'pe1', plugin_name: 'p', request_id: null, type: 'custom', severity: 'info', rule: 'r', detail: 'd', matched_text: null });
    repo.insert({ id: 'pe2', plugin_name: 'p', request_id: null, type: 'custom', severity: 'info', rule: 'r', detail: 'd', matched_text: null });

    insertAt(db, 'pe1', 48);

    const purged = repo.purgeOlderThan(24);
    expect(purged).toBe(1);
    expect(repo.getRecent(10)).toHaveLength(1);
    expect(repo.getRecent(10)[0].id).toBe('pe2');
  });

  it('getStats returns correct aggregates', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);

    repo.insert({ id: 'pe1', plugin_name: 'alpha', request_id: null, type: 'custom', severity: 'info', rule: 'r', detail: 'd', matched_text: null });
    repo.insert({ id: 'pe2', plugin_name: 'alpha', request_id: null, type: 'dlp', severity: 'high', rule: 'r', detail: 'd', matched_text: null });
    repo.insert({ id: 'pe3', plugin_name: 'beta', request_id: null, type: 'custom', severity: 'info', rule: 'r', detail: 'd', matched_text: null });

    const stats = repo.getStats();
    expect(stats.total_events).toBe(3);
    expect(stats.by_plugin.alpha).toBe(2);
    expect(stats.by_plugin.beta).toBe(1);
    expect(stats.by_type.custom).toBe(2);
    expect(stats.by_type.dlp).toBe(1);
  });
});
