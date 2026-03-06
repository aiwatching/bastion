import type Database from 'better-sqlite3';

export interface ThreatScoreRecord {
  session_id: string;
  score: number;
  level: string;
  event_count: number;
  last_event_at: string | null;
  updated_at: string;
}

export class ThreatScoresRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsert(record: {
    session_id: string;
    score: number;
    level: string;
    event_count: number;
    last_event_at: string | null;
  }): void {
    this.db.prepare(`
      INSERT INTO threat_scores (session_id, score, level, event_count, last_event_at, updated_at)
      VALUES (@session_id, @score, @level, @event_count, @last_event_at, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        score = @score,
        level = @level,
        event_count = @event_count,
        last_event_at = @last_event_at,
        updated_at = datetime('now')
    `).run(record);
  }

  get(sessionId: string): ThreatScoreRecord | null {
    return (this.db.prepare(
      'SELECT * FROM threat_scores WHERE session_id = ?'
    ).get(sessionId) as ThreatScoreRecord | undefined) ?? null;
  }

  getAll(): ThreatScoreRecord[] {
    return this.db.prepare(
      'SELECT * FROM threat_scores ORDER BY updated_at DESC'
    ).all() as ThreatScoreRecord[];
  }

  getElevated(): ThreatScoreRecord[] {
    return this.db.prepare(
      "SELECT * FROM threat_scores WHERE level != 'normal' ORDER BY score DESC"
    ).all() as ThreatScoreRecord[];
  }

  reset(sessionId: string): void {
    this.db.prepare(`
      UPDATE threat_scores SET score = 0, level = 'normal', event_count = 0, updated_at = datetime('now')
      WHERE session_id = ?
    `).run(sessionId);
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM threat_scores WHERE updated_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}
