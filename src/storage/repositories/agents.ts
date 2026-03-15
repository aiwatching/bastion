import type Database from 'better-sqlite3';

export type AgentTrustLevel = 'untrusted' | 'standard' | 'trusted' | 'privileged';
export type AgentStatus = 'active' | 'suspended' | 'revoked';

export interface AgentRecord {
  id: string;
  name: string;
  description: string | null;
  owner: string | null;
  trust_level: AgentTrustLevel;
  status: AgentStatus;
  secret_hash: string | null;
  encrypted_secret: string | null;
  tool_scope: string | null; // JSON array or null
  metadata: string | null;   // JSON object or null
  request_count: number;
  total_tokens: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export class AgentsRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(record: {
    id: string;
    name: string;
    description?: string | null;
    owner?: string | null;
    trust_level?: AgentTrustLevel;
    status?: AgentStatus;
    secret_hash?: string | null;
    encrypted_secret?: string | null;
    tool_scope?: string[] | null;
    metadata?: Record<string, unknown> | null;
  }): void {
    this.db.prepare(`
      INSERT INTO agents (id, name, description, owner, trust_level, status, secret_hash, encrypted_secret, tool_scope, metadata)
      VALUES (@id, @name, @description, @owner, @trust_level, @status, @secret_hash, @encrypted_secret, @tool_scope, @metadata)
    `).run({
      id: record.id,
      name: record.name,
      description: record.description ?? null,
      owner: record.owner ?? null,
      trust_level: record.trust_level ?? 'standard',
      status: record.status ?? 'active',
      secret_hash: record.secret_hash ?? null,
      encrypted_secret: record.encrypted_secret ?? null,
      tool_scope: record.tool_scope ? JSON.stringify(record.tool_scope) : null,
      metadata: record.metadata ? JSON.stringify(record.metadata) : null,
    });
  }

  update(id: string, fields: {
    name?: string;
    description?: string | null;
    owner?: string | null;
    trust_level?: AgentTrustLevel;
    tool_scope?: string[] | null;
    metadata?: Record<string, unknown> | null;
    secret_hash?: string | null;
    encrypted_secret?: string | null;
  }): boolean {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.name !== undefined) { sets.push('name = @name'); params.name = fields.name; }
    if (fields.description !== undefined) { sets.push('description = @description'); params.description = fields.description; }
    if (fields.owner !== undefined) { sets.push('owner = @owner'); params.owner = fields.owner; }
    if (fields.trust_level !== undefined) { sets.push('trust_level = @trust_level'); params.trust_level = fields.trust_level; }
    if (fields.tool_scope !== undefined) { sets.push('tool_scope = @tool_scope'); params.tool_scope = fields.tool_scope ? JSON.stringify(fields.tool_scope) : null; }
    if (fields.metadata !== undefined) { sets.push('metadata = @metadata'); params.metadata = fields.metadata ? JSON.stringify(fields.metadata) : null; }
    if (fields.secret_hash !== undefined) { sets.push('secret_hash = @secret_hash'); params.secret_hash = fields.secret_hash; }
    if (fields.encrypted_secret !== undefined) { sets.push('encrypted_secret = @encrypted_secret'); params.encrypted_secret = fields.encrypted_secret; }

    if (sets.length === 0) return false;
    sets.push("updated_at = datetime('now')");

    const result = this.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return result.changes > 0;
  }

  get(id: string): AgentRecord | null {
    return (this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRecord | undefined) ?? null;
  }

  getByName(name: string): AgentRecord | null {
    return (this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as AgentRecord | undefined) ?? null;
  }

  getAll(limit: number = 100): AgentRecord[] {
    return this.db.prepare('SELECT * FROM agents ORDER BY updated_at DESC LIMIT ?').all(limit) as AgentRecord[];
  }

  getActive(): AgentRecord[] {
    return this.db.prepare("SELECT * FROM agents WHERE status = 'active' ORDER BY last_seen_at DESC").all() as AgentRecord[];
  }

  setStatus(id: string, status: AgentStatus): boolean {
    const result = this.db.prepare(`
      UPDATE agents SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id);
    return result.changes > 0;
  }

  updateStats(id: string, stats: { tokens: number; cost: number }): void {
    this.db.prepare(`
      UPDATE agents SET
        request_count = request_count + 1,
        total_tokens = total_tokens + @tokens,
        total_cost_usd = total_cost_usd + @cost,
        last_seen_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = @id
    `).run({ id, tokens: stats.tokens, cost: stats.cost });
  }

  touch(id: string): void {
    this.db.prepare("UPDATE agents SET last_seen_at = datetime('now') WHERE id = ?").run(id);
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM agents WHERE last_seen_at < datetime('now', '-' || ? || ' hours') AND status = 'revoked'`
    ).run(hours);
    return result.changes;
  }
}
