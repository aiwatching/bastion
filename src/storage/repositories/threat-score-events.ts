import type Database from 'better-sqlite3';

export interface ThreatScoreEventRecord {
  id: string;
  session_id: string;
  event_type: string;
  source_event: string | null;
  points: number;
  score_after: number;
  level_after: string;
  created_at: string;
}

export class ThreatScoreEventsRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(record: {
    id: string;
    session_id: string;
    event_type: string;
    source_event: string | null;
    points: number;
    score_after: number;
    level_after: string;
  }): void {
    this.db.prepare(`
      INSERT INTO threat_score_events (id, session_id, event_type, source_event, points, score_after, level_after)
      VALUES (@id, @session_id, @event_type, @source_event, @points, @score_after, @level_after)
    `).run(record);
  }

  getBySession(sessionId: string, limit: number = 50): ThreatScoreEventRecord[] {
    return this.db.prepare(
      'SELECT * FROM threat_score_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(sessionId, limit) as ThreatScoreEventRecord[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM threat_score_events WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}
