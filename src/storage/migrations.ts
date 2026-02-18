import type Database from 'better-sqlite3';

const MIGRATIONS: string[] = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_creation_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    cached INTEGER DEFAULT 0,
    dlp_action TEXT,
    dlp_findings INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    encrypted_response BLOB NOT NULL,
    iv BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_hit_at TEXT,
    hit_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS dlp_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    pattern_name TEXT NOT NULL,
    pattern_category TEXT NOT NULL,
    action TEXT NOT NULL,
    match_count INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
  CREATE INDEX IF NOT EXISTS idx_requests_provider ON requests(provider);
  CREATE INDEX IF NOT EXISTS idx_cache_last_hit ON cache(last_hit_at);
  CREATE INDEX IF NOT EXISTS idx_dlp_events_request ON dlp_events(request_id);
  `,
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersion = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number | null }
    | undefined;
  const version = currentVersion?.version ?? 0;

  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec(MIGRATIONS[i]);
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
  }
}
