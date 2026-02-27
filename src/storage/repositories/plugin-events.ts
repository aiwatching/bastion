import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export interface PluginEventRecord {
  id: string;
  plugin_name: string;
  request_id: string | null;
  type: string;
  severity: string;
  rule: string;
  detail: string;
  matched_text: string | null;
  created_at: string;
}

export class PluginEventsRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO plugin_events (id, plugin_name, request_id, type, severity, rule, detail, matched_text)
      VALUES (@id, @plugin_name, @request_id, @type, @severity, @rule, @detail, @matched_text)
    `);
  }

  insert(record: Omit<PluginEventRecord, 'created_at'>): void {
    this.insertStmt.run(record);
  }

  insertEvent(pluginName: string, requestId: string | null, event: { type: string; severity: string; rule: string; detail: string; matchedText?: string }): void {
    this.insert({
      id: crypto.randomUUID(),
      plugin_name: pluginName,
      request_id: requestId,
      type: event.type,
      severity: event.severity,
      rule: event.rule,
      detail: event.detail,
      matched_text: event.matchedText ?? null,
    });
  }

  getRecent(limit: number = 20, sinceHours?: number): PluginEventRecord[] {
    if (sinceHours) {
      return this.db.prepare(`
        SELECT * FROM plugin_events
        WHERE created_at > datetime('now', '-' || ? || ' hours')
        ORDER BY created_at DESC LIMIT ?
      `).all(sinceHours, limit) as PluginEventRecord[];
    }
    return this.db.prepare(
      'SELECT * FROM plugin_events ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as PluginEventRecord[];
  }

  getByPlugin(pluginName: string, limit: number = 20): PluginEventRecord[] {
    return this.db.prepare(
      'SELECT * FROM plugin_events WHERE plugin_name = ? ORDER BY created_at DESC LIMIT ?'
    ).all(pluginName, limit) as PluginEventRecord[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM plugin_events WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }

  getStats(): { total_events: number; by_plugin: Record<string, number>; by_type: Record<string, number> } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM plugin_events').get() as { count: number };
    const pluginRows = this.db.prepare(
      'SELECT plugin_name, COUNT(*) as count FROM plugin_events GROUP BY plugin_name'
    ).all() as { plugin_name: string; count: number }[];
    const typeRows = this.db.prepare(
      'SELECT type, COUNT(*) as count FROM plugin_events GROUP BY type'
    ).all() as { type: string; count: number }[];

    const by_plugin: Record<string, number> = {};
    for (const row of pluginRows) by_plugin[row.plugin_name] = row.count;

    const by_type: Record<string, number> = {};
    for (const row of typeRows) by_type[row.type] = row.count;

    return { total_events: total.count, by_plugin, by_type };
  }
}
