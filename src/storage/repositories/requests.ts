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

export class RequestsRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO requests (id, provider, model, method, path, status_code,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, latency_ms, cached, dlp_action, dlp_findings)
      VALUES (@id, @provider, @model, @method, @path, @status_code,
        @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens,
        @cost_usd, @latency_ms, @cached, @dlp_action, @dlp_findings)
    `);
  }

  insert(record: Omit<RequestRecord, 'created_at'>): void {
    this.insertStmt.run(record);
  }

  getStats(sinceHours?: number): RequestStats {
    const whereClause = sinceHours
      ? `WHERE created_at >= datetime('now', '-${sinceHours} hours')`
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
    `).get() as {
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
    `).all() as { provider: string; requests: number; cost_usd: number }[];

    const modelRows = this.db.prepare(`
      SELECT model, COUNT(*) as requests, COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM requests ${whereClause}
      GROUP BY model
    `).all() as { model: string; requests: number; cost_usd: number }[];

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

  getRecent(limit: number = 10): RequestRecord[] {
    return this.db.prepare(`
      SELECT * FROM requests ORDER BY created_at DESC LIMIT ?
    `).all(limit) as RequestRecord[];
  }
}
