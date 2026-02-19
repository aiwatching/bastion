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

  // Migration 2: Session tracking, audit log, optimizer events, DLP snippets
  `
  ALTER TABLE requests ADD COLUMN session_id TEXT;
  ALTER TABLE requests ADD COLUMN api_key_hash TEXT;

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    encrypted_content BLOB,
    iv BLOB NOT NULL,
    auth_tag BLOB NOT NULL,
    request_length INTEGER DEFAULT 0,
    response_length INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS optimizer_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    cache_hit INTEGER DEFAULT 0,
    original_length INTEGER DEFAULT 0,
    trimmed_length INTEGER DEFAULT 0,
    chars_saved INTEGER DEFAULT 0,
    tokens_saved_estimate INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE dlp_events ADD COLUMN original_snippet TEXT;
  ALTER TABLE dlp_events ADD COLUMN redacted_snippet TEXT;

  CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
  CREATE INDEX IF NOT EXISTS idx_requests_api_key ON requests(api_key_hash);
  CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_log(request_id);
  CREATE INDEX IF NOT EXISTS idx_optimizer_request ON optimizer_events(request_id);
  `,

  // Migration 3: Sessions table for session metadata and client identification
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    label TEXT,
    source TEXT DEFAULT 'auto',
    project_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);
  `,

  // Migration 4: DLP patterns table for DB-backed, UI-configurable patterns
  `
  CREATE TABLE IF NOT EXISTS dlp_patterns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'custom',
    regex_source TEXT NOT NULL,
    regex_flags TEXT DEFAULT 'g',
    description TEXT,
    validator TEXT,
    require_context TEXT,
    enabled INTEGER DEFAULT 1,
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 5: DLP direction column (request vs response scanning)
  `
  ALTER TABLE dlp_events ADD COLUMN direction TEXT DEFAULT 'request';
  `,

  // Migration 6: Audit log DLP hit flag and summary column
  `
  ALTER TABLE audit_log ADD COLUMN dlp_hit INTEGER DEFAULT 0;
  ALTER TABLE audit_log ADD COLUMN summary TEXT;
  CREATE INDEX IF NOT EXISTS idx_audit_dlp_hit ON audit_log(dlp_hit);
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
