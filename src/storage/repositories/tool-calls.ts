import type Database from 'better-sqlite3';

export interface ToolCallRecord {
  id: string;
  request_id: string;
  tool_name: string;
  tool_input: string | null;
  rule_id: string | null;
  rule_name: string | null;
  severity: string | null;
  category: string | null;
  action: string | null;
  provider: string | null;
  session_id: string | null;
  created_at: string;
}

export interface ToolCallStats {
  total: number;
  flagged: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  topToolNames: Array<{ tool_name: string; count: number }>;
}

const MAX_INPUT_BYTES = 2048;

export class ToolCallsRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO tool_calls (id, request_id, tool_name, tool_input, rule_id, rule_name, severity, category, action, provider, session_id)
      VALUES (@id, @request_id, @tool_name, @tool_input, @rule_id, @rule_name, @severity, @category, @action, @provider, @session_id)
    `);
  }

  insert(record: {
    id: string;
    request_id: string;
    tool_name: string;
    tool_input: string;
    rule_id: string | null;
    rule_name: string | null;
    severity: string | null;
    category: string | null;
    action: string | null;
    provider: string;
    session_id: string | null;
  }): void {
    this.insertStmt.run({
      ...record,
      tool_input: record.tool_input.length > MAX_INPUT_BYTES
        ? record.tool_input.slice(0, MAX_INPUT_BYTES)
        : record.tool_input,
    });
  }

  getRecent(limit: number = 50, since?: string): ToolCallRecord[] {
    if (since) {
      return this.db.prepare(`
        SELECT * FROM tool_calls WHERE created_at > ? ORDER BY created_at DESC LIMIT ?
      `).all(since, limit) as ToolCallRecord[];
    }
    return this.db.prepare(`
      SELECT * FROM tool_calls ORDER BY created_at DESC LIMIT ?
    `).all(limit) as ToolCallRecord[];
  }

  getBySession(sessionId: string): ToolCallRecord[] {
    return this.db.prepare(`
      SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at DESC
    `).all(sessionId) as ToolCallRecord[];
  }

  getStats(): ToolCallStats {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM tool_calls').get() as { c: number }).c;
    const flagged = (this.db.prepare('SELECT COUNT(*) as c FROM tool_calls WHERE severity IS NOT NULL').get() as { c: number }).c;

    const bySeverityRows = this.db.prepare(
      'SELECT severity, COUNT(*) as c FROM tool_calls WHERE severity IS NOT NULL GROUP BY severity'
    ).all() as Array<{ severity: string; c: number }>;
    const bySeverity: Record<string, number> = {};
    for (const row of bySeverityRows) bySeverity[row.severity] = row.c;

    const byCategoryRows = this.db.prepare(
      'SELECT category, COUNT(*) as c FROM tool_calls WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC'
    ).all() as Array<{ category: string; c: number }>;
    const byCategory: Record<string, number> = {};
    for (const row of byCategoryRows) byCategory[row.category] = row.c;

    const topToolNames = this.db.prepare(
      'SELECT tool_name, COUNT(*) as count FROM tool_calls GROUP BY tool_name ORDER BY count DESC LIMIT 10'
    ).all() as Array<{ tool_name: string; count: number }>;

    return { total, flagged, bySeverity, byCategory, topToolNames };
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM tool_calls WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}
