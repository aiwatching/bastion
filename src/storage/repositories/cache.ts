import type Database from 'better-sqlite3';

export interface CacheRecord {
  key: string;
  provider: string;
  model: string;
  encrypted_response: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  last_hit_at: string | null;
  hit_count: number;
}

export class CacheRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(key: string, ttlSeconds?: number): CacheRecord | undefined {
    let query = 'SELECT * FROM cache WHERE key = ?';
    if (ttlSeconds && ttlSeconds > 0) {
      query += ` AND created_at > datetime('now', '-${Math.floor(ttlSeconds)} seconds')`;
    }
    const record = this.db.prepare(query).get(key) as CacheRecord | undefined;
    if (!record) return undefined;
    this.db.prepare("UPDATE cache SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE key = ?").run(key);
    // Return with updated hit_count
    record.hit_count += 1;
    return record;
  }

  set(record: Omit<CacheRecord, 'created_at' | 'last_hit_at' | 'hit_count'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO cache (key, provider, model, encrypted_response, iv, auth_tag, input_tokens, output_tokens)
      VALUES (@key, @provider, @model, @encrypted_response, @iv, @auth_tag, @input_tokens, @output_tokens)
    `).run(record);
  }

  getStats(): { total_entries: number; total_hits: number } {
    const result = this.db.prepare(`
      SELECT COUNT(*) as total_entries, COALESCE(SUM(hit_count), 0) as total_hits FROM cache
    `).get() as { total_entries: number; total_hits: number };
    return result;
  }

  evictOldest(keepCount: number): number {
    const result = this.db.prepare(`
      DELETE FROM cache WHERE key NOT IN (
        SELECT key FROM cache ORDER BY last_hit_at DESC, created_at DESC LIMIT ?
      )
    `).run(keepCount);
    return result.changes;
  }
}
