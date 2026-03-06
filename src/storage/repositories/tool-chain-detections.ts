import type Database from 'better-sqlite3';

export interface ToolChainDetectionRecord {
  id: string;
  session_id: string;
  rule_id: string;
  matched_sequence: string;
  action: string;
  created_at: string;
}

export class ToolChainDetectionsRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(record: {
    id: string;
    session_id: string;
    rule_id: string;
    matched_sequence: string;
    action: string;
  }): void {
    this.db.prepare(`
      INSERT INTO tool_chain_detections (id, session_id, rule_id, matched_sequence, action)
      VALUES (@id, @session_id, @rule_id, @matched_sequence, @action)
    `).run(record);
  }

  getRecent(limit: number = 50): ToolChainDetectionRecord[] {
    return this.db.prepare(
      'SELECT * FROM tool_chain_detections ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as ToolChainDetectionRecord[];
  }

  getBySession(sessionId: string): ToolChainDetectionRecord[] {
    return this.db.prepare(
      'SELECT * FROM tool_chain_detections WHERE session_id = ? ORDER BY created_at DESC'
    ).all(sessionId) as ToolChainDetectionRecord[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM tool_chain_detections WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}
