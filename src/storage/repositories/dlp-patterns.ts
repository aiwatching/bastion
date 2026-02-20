import type Database from 'better-sqlite3';
import type { DlpPattern } from '../../dlp/engine.js';

export interface DlpPatternRecord {
  id: string;
  name: string;
  category: string;
  regex_source: string;
  regex_flags: string;
  description: string | null;
  validator: string | null;
  require_context: string | null; // JSON array or null
  enabled: number;
  is_builtin: number;
  created_at: string;
}

export class DlpPatternsRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Seed built-in patterns from the hardcoded pattern files.
   * First seed: only enable categories matching enabledCategories.
   * Subsequent: new builtins added get enabled=1 by default, existing rows untouched.
   */
  seedBuiltins(patterns: DlpPattern[], enabledCategories: string[]): void {
    const enabledSet = new Set(enabledCategories);
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO dlp_patterns (id, name, category, regex_source, regex_flags, description, validator, require_context, enabled, is_builtin)
      VALUES (@id, @name, @category, @regex_source, @regex_flags, @description, @validator, @require_context, @enabled, 1)
    `);

    const seed = this.db.transaction(() => {
      for (const p of patterns) {
        stmt.run({
          id: `builtin-${p.name}`,
          name: p.name,
          category: p.category,
          regex_source: p.regex.source,
          regex_flags: p.regex.flags,
          description: p.description ?? null,
          validator: p.validator ?? null,
          require_context: p.requireContext ? JSON.stringify(p.requireContext) : null,
          enabled: enabledSet.has(p.category) ? 1 : 0,
        });
      }
    });
    seed();
  }

  /** Get all enabled patterns, converted to DlpPattern objects */
  getEnabled(): DlpPattern[] {
    const rows = this.db.prepare(
      'SELECT * FROM dlp_patterns WHERE enabled = 1'
    ).all() as DlpPatternRecord[];
    return rows.map(rowToPattern);
  }

  /** Get all patterns for UI listing */
  getAll(): DlpPatternRecord[] {
    return this.db.prepare(
      'SELECT * FROM dlp_patterns ORDER BY is_builtin DESC, category, name'
    ).all() as DlpPatternRecord[];
  }

  /** Toggle enabled flag */
  toggle(id: string, enabled: boolean): void {
    this.db.prepare(
      'UPDATE dlp_patterns SET enabled = ? WHERE id = ?'
    ).run(enabled ? 1 : 0, id);
  }

  /** Insert or update a pattern */
  upsert(record: {
    id: string;
    name: string;
    category?: string;
    regex_source: string;
    regex_flags?: string;
    description?: string | null;
    validator?: string | null;
    require_context?: string | null;
    enabled?: boolean;
  }): void {
    this.db.prepare(`
      INSERT INTO dlp_patterns (id, name, category, regex_source, regex_flags, description, validator, require_context, enabled, is_builtin)
      VALUES (@id, @name, @category, @regex_source, @regex_flags, @description, @validator, @require_context, @enabled, 0)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        category = @category,
        regex_source = @regex_source,
        regex_flags = @regex_flags,
        description = @description,
        validator = @validator,
        require_context = @require_context,
        enabled = @enabled
    `).run({
      id: record.id,
      name: record.name,
      category: record.category ?? 'custom',
      regex_source: record.regex_source,
      regex_flags: record.regex_flags ?? 'g',
      description: record.description ?? null,
      validator: record.validator ?? null,
      require_context: record.require_context ?? null,
      enabled: record.enabled === false ? 0 : 1,
    });
  }

  /**
   * Upsert a remote pattern from the signature repo.
   * New patterns: inserted with enabled based on category match.
   * Existing patterns: regex/description/etc updated, but user's enabled toggle is preserved.
   */
  upsertRemote(record: {
    id: string;
    name: string;
    category: string;
    regex_source: string;
    regex_flags: string;
    description: string | null;
    validator: string | null;
    require_context: string | null;
    enabled: boolean;
    source: string;
  }): void {
    this.db.prepare(`
      INSERT INTO dlp_patterns (id, name, category, regex_source, regex_flags, description, validator, require_context, enabled, is_builtin)
      VALUES (@id, @name, @category, @regex_source, @regex_flags, @description, @validator, @require_context, @enabled, 0)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        category = @category,
        regex_source = @regex_source,
        regex_flags = @regex_flags,
        description = @description,
        validator = @validator,
        require_context = @require_context
    `).run({
      id: record.id,
      name: record.name,
      category: record.category,
      regex_source: record.regex_source,
      regex_flags: record.regex_flags,
      description: record.description,
      validator: record.validator,
      require_context: record.require_context,
      enabled: record.enabled ? 1 : 0,
    });
  }

  /** Get DlpPattern objects by name (regardless of enabled status) */
  getByNames(names: string[]): DlpPattern[] {
    if (names.length === 0) return [];
    const placeholders = names.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM dlp_patterns WHERE name IN (${placeholders})`
    ).all(...names) as DlpPatternRecord[];
    return rows.map(rowToPattern);
  }

  /** Delete a custom pattern. Rejects if is_builtin=1. Returns true if deleted. */
  remove(id: string): boolean {
    const row = this.db.prepare(
      'SELECT is_builtin FROM dlp_patterns WHERE id = ?'
    ).get(id) as { is_builtin: number } | undefined;

    if (!row) return false;
    if (row.is_builtin === 1) {
      throw new Error('Cannot delete built-in pattern');
    }

    this.db.prepare('DELETE FROM dlp_patterns WHERE id = ?').run(id);
    return true;
  }
}

function rowToPattern(row: DlpPatternRecord): DlpPattern {
  return {
    name: row.name,
    category: row.category,
    regex: new RegExp(row.regex_source, row.regex_flags),
    description: row.description ?? '',
    validator: row.validator ?? undefined,
    requireContext: row.require_context ? JSON.parse(row.require_context) : undefined,
  };
}
