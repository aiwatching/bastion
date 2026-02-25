import type Database from 'better-sqlite3';
import type { ToolGuardRule } from '../../tool-guard/rules.js';

export interface ToolGuardRuleRecord {
  id: string;
  name: string;
  description: string | null;
  severity: string;
  category: string;
  tool_name_pattern: string | null;
  tool_name_flags: string | null;
  input_pattern: string;
  input_flags: string;
  enabled: number;
  is_builtin: number;
  created_at: string;
}

export class ToolGuardRulesRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Seed built-in rules. INSERT OR IGNORE preserves user toggle state. */
  seedBuiltins(rules: ToolGuardRule[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO tool_guard_rules
        (id, name, description, severity, category, tool_name_pattern, tool_name_flags, input_pattern, input_flags, enabled, is_builtin)
      VALUES
        (@id, @name, @description, @severity, @category, @tool_name_pattern, @tool_name_flags, @input_pattern, @input_flags, 1, 1)
    `);

    const seed = this.db.transaction(() => {
      for (const r of rules) {
        stmt.run({
          id: r.id,
          name: r.name,
          description: r.description ?? null,
          severity: r.severity,
          category: r.category,
          tool_name_pattern: r.match.toolName?.source ?? null,
          tool_name_flags: r.match.toolName?.flags ?? null,
          input_pattern: r.match.inputPattern?.source ?? '',
          input_flags: r.match.inputPattern?.flags ?? 'i',
        });
      }
    });
    seed();
  }

  /** Get all enabled rules, converted to ToolGuardRule objects */
  getEnabled(): ToolGuardRule[] {
    const rows = this.db.prepare(
      'SELECT * FROM tool_guard_rules WHERE enabled = 1'
    ).all() as ToolGuardRuleRecord[];
    return rows.map(rowToRule);
  }

  /** Get all rules for UI listing */
  getAll(): ToolGuardRuleRecord[] {
    return this.db.prepare(
      'SELECT * FROM tool_guard_rules ORDER BY is_builtin DESC, category, name'
    ).all() as ToolGuardRuleRecord[];
  }

  /** Toggle enabled flag */
  toggle(id: string, enabled: boolean): void {
    this.db.prepare(
      'UPDATE tool_guard_rules SET enabled = ? WHERE id = ?'
    ).run(enabled ? 1 : 0, id);
  }

  /** Insert or update a custom rule */
  upsert(record: {
    id: string;
    name: string;
    description?: string | null;
    severity?: string;
    category?: string;
    tool_name_pattern?: string | null;
    tool_name_flags?: string | null;
    input_pattern: string;
    input_flags?: string;
    enabled?: boolean;
  }): void {
    this.db.prepare(`
      INSERT INTO tool_guard_rules
        (id, name, description, severity, category, tool_name_pattern, tool_name_flags, input_pattern, input_flags, enabled, is_builtin)
      VALUES
        (@id, @name, @description, @severity, @category, @tool_name_pattern, @tool_name_flags, @input_pattern, @input_flags, @enabled, 0)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        description = @description,
        severity = @severity,
        category = @category,
        tool_name_pattern = @tool_name_pattern,
        tool_name_flags = @tool_name_flags,
        input_pattern = @input_pattern,
        input_flags = @input_flags,
        enabled = @enabled
    `).run({
      id: record.id,
      name: record.name,
      description: record.description ?? null,
      severity: record.severity ?? 'medium',
      category: record.category ?? 'custom',
      tool_name_pattern: record.tool_name_pattern ?? null,
      tool_name_flags: record.tool_name_flags ?? null,
      input_pattern: record.input_pattern,
      input_flags: record.input_flags ?? 'i',
      enabled: record.enabled === false ? 0 : 1,
    });
  }

  /** Delete a custom rule. Rejects if is_builtin=1. Returns true if deleted. */
  remove(id: string): boolean {
    const row = this.db.prepare(
      'SELECT is_builtin FROM tool_guard_rules WHERE id = ?'
    ).get(id) as { is_builtin: number } | undefined;

    if (!row) return false;
    if (row.is_builtin === 1) {
      throw new Error('Cannot delete built-in rule');
    }

    this.db.prepare('DELETE FROM tool_guard_rules WHERE id = ?').run(id);
    return true;
  }
}

function rowToRule(row: ToolGuardRuleRecord): ToolGuardRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    severity: row.severity as ToolGuardRule['severity'],
    category: row.category,
    match: {
      toolName: row.tool_name_pattern ? new RegExp(row.tool_name_pattern, row.tool_name_flags ?? '') : undefined,
      inputPattern: row.input_pattern ? new RegExp(row.input_pattern, row.input_flags ?? 'i') : undefined,
    },
  };
}
