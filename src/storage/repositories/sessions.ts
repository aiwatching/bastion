import type Database from 'better-sqlite3';

export interface SessionRecord {
  id: string;
  label: string | null;
  source: string;
  project_path: string | null;
  created_at: string;
  last_seen_at: string;
}

export class SessionsRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsert(id: string, info: { label?: string; source?: string; projectPath?: string }): void {
    const existing = this.get(id);
    if (existing) {
      // Update: only overwrite label/project_path if provided and currently null
      const label = existing.label ?? info.label ?? null;
      const projectPath = existing.project_path ?? info.projectPath ?? null;
      this.db.prepare(`
        UPDATE sessions SET label = ?, project_path = ?, last_seen_at = datetime('now')
        WHERE id = ?
      `).run(label, projectPath, id);
    } else {
      this.db.prepare(`
        INSERT INTO sessions (id, label, source, project_path)
        VALUES (?, ?, ?, ?)
      `).run(id, info.label ?? null, info.source ?? 'auto', info.projectPath ?? null);
    }
  }

  get(id: string): SessionRecord | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRecord | undefined;
  }

  touch(id: string): void {
    this.db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(id);
  }

  getAll(limit: number = 50): SessionRecord[] {
    return this.db.prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT ?').all(limit) as SessionRecord[];
  }
}
