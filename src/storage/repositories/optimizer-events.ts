import type Database from 'better-sqlite3';

export interface OptimizerEventRecord {
  id: string;
  request_id: string;
  cache_hit: number;
  original_length: number;
  trimmed_length: number;
  chars_saved: number;
  tokens_saved_estimate: number;
  created_at: string;
}

export interface OptimizerStats {
  total_events: number;
  total_cache_hits: number;
  cache_hit_rate: number;
  total_chars_saved: number;
  total_tokens_saved: number;
}

export class OptimizerEventsRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO optimizer_events (id, request_id, cache_hit, original_length, trimmed_length, chars_saved, tokens_saved_estimate)
      VALUES (@id, @request_id, @cache_hit, @original_length, @trimmed_length, @chars_saved, @tokens_saved_estimate)
    `);
  }

  insert(record: Omit<OptimizerEventRecord, 'created_at'>): void {
    this.insertStmt.run(record);
  }

  getStats(): OptimizerStats {
    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total_events,
        COALESCE(SUM(cache_hit), 0) as total_cache_hits,
        COALESCE(SUM(chars_saved), 0) as total_chars_saved,
        COALESCE(SUM(tokens_saved_estimate), 0) as total_tokens_saved
      FROM optimizer_events
    `).get() as {
      total_events: number;
      total_cache_hits: number;
      total_chars_saved: number;
      total_tokens_saved: number;
    };

    return {
      ...result,
      cache_hit_rate: result.total_events > 0
        ? result.total_cache_hits / result.total_events
        : 0,
    };
  }

  getRecent(limit: number = 20, sinceHours?: number): OptimizerEventRecord[] {
    if (sinceHours) {
      return this.db.prepare(`
        SELECT * FROM optimizer_events WHERE created_at > datetime('now', '-' || ? || ' hours') ORDER BY created_at DESC LIMIT ?
      `).all(sinceHours, limit) as OptimizerEventRecord[];
    }
    return this.db.prepare(`
      SELECT * FROM optimizer_events ORDER BY created_at DESC LIMIT ?
    `).all(limit) as OptimizerEventRecord[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM optimizer_events WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}
