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

  // Migration 7: DLP config change history
  `
  CREATE TABLE IF NOT EXISTS dlp_config_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 8: Tool Guard — tool_calls table for audit
  `
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    rule_id TEXT,
    rule_name TEXT,
    severity TEXT,
    category TEXT,
    provider TEXT,
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tool_calls_request ON tool_calls(request_id);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_severity ON tool_calls(severity);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_created ON tool_calls(created_at);
  `,

  // Migration 9: Tool Guard — action result column on tool_calls
  `
  ALTER TABLE tool_calls ADD COLUMN action TEXT;
  `,

  // Migration 10: Tool Guard rules table for DB-backed, UI-configurable rules
  `
  CREATE TABLE IF NOT EXISTS tool_guard_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    severity TEXT NOT NULL DEFAULT 'medium',
    category TEXT NOT NULL DEFAULT 'custom',
    tool_name_pattern TEXT,
    tool_name_flags TEXT,
    input_pattern TEXT NOT NULL,
    input_flags TEXT DEFAULT 'i',
    enabled INTEGER DEFAULT 1,
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 11: Audit log — tool_guard_hit column + ensure action column exists
  // (action column may already exist from migration 9 on fresh installs; runner handles duplicate)
  `
  ALTER TABLE tool_calls ADD COLUMN action TEXT;
  ALTER TABLE audit_log ADD COLUMN tool_guard_hit INTEGER DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_audit_tool_guard_hit ON audit_log(tool_guard_hit);
  `,

  // Migration 12: Ensure tool_calls.action column exists (catch-up for DBs that skipped migration 9/11)
  `
  ALTER TABLE tool_calls ADD COLUMN action TEXT;
  `,

  // Migration 13: Backfill action + severity for existing records
  `
  UPDATE tool_calls SET action = 'flag' WHERE action IS NULL AND rule_id IS NOT NULL;
  UPDATE tool_calls SET action = 'pass', severity = 'info' WHERE action IS NULL AND rule_id IS NULL;
  `,

  // Migration 14: Audit log — plugin pipeline fail-closed tracking
  `
  ALTER TABLE audit_log ADD COLUMN failed_plugin TEXT;
  ALTER TABLE audit_log ADD COLUMN fail_action TEXT;
  `,

  // Migration 15: Plugin events table for external plugin event storage
  `
  CREATE TABLE IF NOT EXISTS plugin_events (
    id TEXT PRIMARY KEY,
    plugin_name TEXT NOT NULL,
    request_id TEXT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    rule TEXT NOT NULL,
    detail TEXT NOT NULL,
    matched_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_plugin_events_plugin ON plugin_events(plugin_name);
  CREATE INDEX IF NOT EXISTS idx_plugin_events_request ON plugin_events(request_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_events_created ON plugin_events(created_at);
  `,

  // Migration 16: DLP patterns — context_verify column for anti-pattern / entropy / code-block checks
  `
  ALTER TABLE dlp_patterns ADD COLUMN context_verify TEXT;
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
    try {
      db.exec(MIGRATIONS[i]);
    } catch (err) {
      // Handle duplicate column errors from idempotent ALTER TABLE statements
      if (err instanceof Error && err.message.includes('duplicate column')) {
        // Execute statements individually, skipping duplicate column errors
        const statements = MIGRATIONS[i].split(';').map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
          try {
            db.exec(stmt);
          } catch (stmtErr) {
            if (!(stmtErr instanceof Error) || !stmtErr.message.includes('duplicate column')) {
              throw stmtErr;
            }
          }
        }
      } else {
        throw err;
      }
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
  }
}
