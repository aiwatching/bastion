import type Database from 'better-sqlite3';

export interface DlpConfigHistoryEntry {
  id: number;
  config_json: string;
  created_at: string;
}

const MAX_ENTRIES = 10;

export class DlpConfigHistoryRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Save a DLP config snapshot and prune old entries beyond MAX_ENTRIES */
  insert(config: object): number {
    const stmt = this.db.prepare(
      'INSERT INTO dlp_config_history (config_json) VALUES (?)',
    );
    const result = stmt.run(JSON.stringify(config));

    // Prune old entries
    this.db.prepare(
      `DELETE FROM dlp_config_history WHERE id NOT IN (
        SELECT id FROM dlp_config_history ORDER BY id DESC LIMIT ?
      )`,
    ).run(MAX_ENTRIES);

    return result.lastInsertRowid as number;
  }

  /** Get the most recent entries (newest first) */
  getRecent(limit = MAX_ENTRIES): DlpConfigHistoryEntry[] {
    return this.db.prepare(
      'SELECT id, config_json, created_at FROM dlp_config_history ORDER BY id DESC LIMIT ?',
    ).all(limit) as DlpConfigHistoryEntry[];
  }

  /** Get a single entry by ID */
  getById(id: number): DlpConfigHistoryEntry | null {
    return (this.db.prepare(
      'SELECT id, config_json, created_at FROM dlp_config_history WHERE id = ?',
    ).get(id) as DlpConfigHistoryEntry) ?? null;
  }
}
