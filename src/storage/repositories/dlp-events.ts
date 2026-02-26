import type Database from 'better-sqlite3';

export interface DlpEventRecord {
  id: string;
  request_id: string;
  pattern_name: string;
  pattern_category: string;
  action: string;
  match_count: number;
  original_snippet: string | null;
  redacted_snippet: string | null;
  direction: string;
  created_at: string;
}

export class DlpEventsRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO dlp_events (id, request_id, pattern_name, pattern_category, action, match_count, original_snippet, redacted_snippet, direction)
      VALUES (@id, @request_id, @pattern_name, @pattern_category, @action, @match_count, @original_snippet, @redacted_snippet, @direction)
    `);
  }

  insert(record: Omit<DlpEventRecord, 'created_at' | 'direction'> & { direction?: string }): void {
    this.insertStmt.run({ ...record, direction: record.direction ?? 'request' });
  }

  getByRequestId(requestId: string): DlpEventRecord[] {
    return this.db.prepare('SELECT * FROM dlp_events WHERE request_id = ?').all(requestId) as DlpEventRecord[];
  }

  getRecent(limit: number = 20, sinceHours?: number): (DlpEventRecord & { provider?: string; model?: string; session_id?: string; session_label?: string })[] {
    if (sinceHours) {
      return this.db.prepare(`
        SELECT d.*, r.provider, r.model, r.session_id, s.label as session_label
        FROM dlp_events d
        LEFT JOIN requests r ON r.id = d.request_id
        LEFT JOIN sessions s ON s.id = r.session_id
        WHERE d.created_at > datetime('now', '-' || ? || ' hours')
        ORDER BY d.created_at DESC LIMIT ?
      `).all(sinceHours, limit) as (DlpEventRecord & { provider?: string; model?: string; session_id?: string; session_label?: string })[];
    }
    return this.db.prepare(`
      SELECT d.*, r.provider, r.model, r.session_id, s.label as session_label
      FROM dlp_events d
      LEFT JOIN requests r ON r.id = d.request_id
      LEFT JOIN sessions s ON s.id = r.session_id
      ORDER BY d.created_at DESC LIMIT ?
    `).all(limit) as (DlpEventRecord & { provider?: string; model?: string; session_id?: string; session_label?: string })[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM dlp_events WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }

  getStats(): { total_events: number; by_action: Record<string, number>; by_pattern: Record<string, number> } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM dlp_events').get() as { count: number };
    const actionRows = this.db.prepare(
      'SELECT action, COUNT(*) as count FROM dlp_events GROUP BY action'
    ).all() as { action: string; count: number }[];
    const patternRows = this.db.prepare(
      'SELECT pattern_name, COUNT(*) as count FROM dlp_events GROUP BY pattern_name'
    ).all() as { pattern_name: string; count: number }[];

    const by_action: Record<string, number> = {};
    for (const row of actionRows) by_action[row.action] = row.count;

    const by_pattern: Record<string, number> = {};
    for (const row of patternRows) by_pattern[row.pattern_name] = row.count;

    return { total_events: total.count, by_action, by_pattern };
  }
}
