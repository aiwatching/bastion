import type Database from 'better-sqlite3';

export interface RequestRecord {
  id: string;
  provider: string;
  model: string;
  method: string;
  path: string;
  status_code: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  latency_ms: number;
  cached: number;
  dlp_action: string | null;
  dlp_findings: number;
  session_id: string | null;
  api_key_hash: string | null;
  created_at: string;
}

export interface RequestStats {
  total_requests: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  cache_hits: number;
  avg_latency_ms: number;
  by_provider: Record<string, { requests: number; cost_usd: number }>;
  by_model: Record<string, { requests: number; cost_usd: number }>;
}

export interface StatsFilter {
  sinceHours?: number;
  sessionId?: string;
  apiKeyHash?: string;
}

export interface SessionInfo {
  session_id: string;
  request_count: number;
  total_cost_usd: number;
  first_seen: string;
  last_seen: string;
  label: string | null;
  source: string | null;
  project_path: string | null;
}

export class RequestsRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO requests (id, provider, model, method, path, status_code,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, latency_ms, cached, dlp_action, dlp_findings, session_id, api_key_hash)
      VALUES (@id, @provider, @model, @method, @path, @status_code,
        @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens,
        @cost_usd, @latency_ms, @cached, @dlp_action, @dlp_findings, @session_id, @api_key_hash)
    `);
  }

  insert(record: Omit<RequestRecord, 'created_at'>): void {
    this.insertStmt.run(record);
  }

  getStats(filter?: StatsFilter): RequestStats {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.sinceHours) {
      conditions.push(`created_at >= datetime('now', '-' || ? || ' hours')`);
      params.push(filter.sinceHours);
    }
    if (filter?.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter?.apiKeyHash) {
      conditions.push('api_key_hash = ?');
      params.push(filter.apiKeyHash);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const totals = this.db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cached), 0) as cache_hits,
        COALESCE(AVG(latency_ms), 0) as avg_latency_ms
      FROM requests ${whereClause}
    `).get(...params) as {
      total_requests: number;
      total_cost_usd: number;
      total_input_tokens: number;
      total_output_tokens: number;
      cache_hits: number;
      avg_latency_ms: number;
    };

    const providerRows = this.db.prepare(`
      SELECT provider, COUNT(*) as requests, COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM requests ${whereClause}
      GROUP BY provider
    `).all(...params) as { provider: string; requests: number; cost_usd: number }[];

    const modelRows = this.db.prepare(`
      SELECT model, COUNT(*) as requests, COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM requests ${whereClause}
      GROUP BY model
    `).all(...params) as { model: string; requests: number; cost_usd: number }[];

    const by_provider: Record<string, { requests: number; cost_usd: number }> = {};
    for (const row of providerRows) {
      by_provider[row.provider] = { requests: row.requests, cost_usd: row.cost_usd };
    }

    const by_model: Record<string, { requests: number; cost_usd: number }> = {};
    for (const row of modelRows) {
      by_model[row.model] = { requests: row.requests, cost_usd: row.cost_usd };
    }

    return { ...totals, by_provider, by_model };
  }

  getRecent(limit: number = 10, sinceHours?: number): RequestRecord[] {
    if (sinceHours) {
      return this.db.prepare(`
        SELECT * FROM requests WHERE created_at > datetime('now', '-' || ? || ' hours') ORDER BY created_at DESC LIMIT ?
      `).all(sinceHours, limit) as RequestRecord[];
    }
    return this.db.prepare(`
      SELECT * FROM requests ORDER BY created_at DESC LIMIT ?
    `).all(limit) as RequestRecord[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM requests WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }

  getSessions(): SessionInfo[] {
    return this.db.prepare(`
      SELECT
        r.session_id,
        COUNT(*) as request_count,
        COALESCE(SUM(r.cost_usd), 0) as total_cost_usd,
        MIN(r.created_at) as first_seen,
        MAX(r.created_at) as last_seen,
        s.label, s.source, s.project_path
      FROM requests r
      LEFT JOIN sessions s ON s.id = r.session_id
      WHERE r.session_id IS NOT NULL
      GROUP BY r.session_id
      ORDER BY last_seen DESC
    `).all() as SessionInfo[];
  }

  getApiKeys(): { api_key_hash: string; request_count: number; total_cost_usd: number }[] {
    return this.db.prepare(`
      SELECT
        api_key_hash,
        COUNT(*) as request_count,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd
      FROM requests
      WHERE api_key_hash IS NOT NULL
      GROUP BY api_key_hash
      ORDER BY request_count DESC
    `).all() as { api_key_hash: string; request_count: number; total_cost_usd: number }[];
  }
}
