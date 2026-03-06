import type Database from 'better-sqlite3';

export interface TaintMarkRecord {
  id: string;
  session_id: string;
  request_id: string;
  pattern_name: string;
  direction: string;
  fingerprint: string | null;
  created_at: string;
}

export class TaintMarksRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(record: {
    id: string;
    session_id: string;
    request_id: string;
    pattern_name: string;
    direction: string;
    fingerprint: string | null;
  }): void {
    this.db.prepare(`
      INSERT INTO taint_marks (id, session_id, request_id, pattern_name, direction, fingerprint)
      VALUES (@id, @session_id, @request_id, @pattern_name, @direction, @fingerprint)
    `).run(record);
  }

  getBySession(sessionId: string): TaintMarkRecord[] {
    return this.db.prepare(
      'SELECT * FROM taint_marks WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as TaintMarkRecord[];
  }

  getActiveBySession(sessionId: string, withinMinutes: number = 60): TaintMarkRecord[] {
    return this.db.prepare(
      `SELECT * FROM taint_marks WHERE session_id = ? AND created_at > datetime('now', '-' || ? || ' minutes') ORDER BY created_at DESC`
    ).all(sessionId, withinMinutes) as TaintMarkRecord[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM taint_marks WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}
