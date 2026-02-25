import { describe, it, expect, afterEach } from 'vitest';
import { createTestDatabase } from '../../../src/storage/database.js';
import { ToolGuardRulesRepository } from '../../../src/storage/repositories/tool-guard-rules.js';
import { BUILTIN_RULES } from '../../../src/tool-guard/rules.js';

describe('ToolGuardRulesRepository', () => {
  let db: ReturnType<typeof createTestDatabase>;

  afterEach(() => {
    if (db) db.close();
  });

  it('seedBuiltins inserts all built-in rules', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);
    repo.seedBuiltins(BUILTIN_RULES);

    const all = repo.getAll();
    expect(all.length).toBe(BUILTIN_RULES.length);
    expect(all.every(r => r.is_builtin === 1)).toBe(true);
  });

  it('seedBuiltins is idempotent — preserves user toggle state', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);
    repo.seedBuiltins(BUILTIN_RULES);

    // Disable one rule
    const first = repo.getAll()[0];
    repo.toggle(first.id, false);

    // Re-seed — should NOT overwrite the disabled state
    repo.seedBuiltins(BUILTIN_RULES);

    const after = repo.getAll().find(r => r.id === first.id);
    expect(after!.enabled).toBe(0);
  });

  it('getEnabled returns only enabled rules as ToolGuardRule objects with RegExp', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);
    repo.seedBuiltins(BUILTIN_RULES);

    // Disable one
    repo.toggle(BUILTIN_RULES[0].id, false);

    const enabled = repo.getEnabled();
    expect(enabled.length).toBe(BUILTIN_RULES.length - 1);
    // Each rule should have RegExp match patterns
    for (const r of enabled) {
      expect(r.match.inputPattern).toBeInstanceOf(RegExp);
    }
  });

  it('toggle enables/disables rules', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);
    repo.seedBuiltins(BUILTIN_RULES);

    const id = BUILTIN_RULES[0].id;
    repo.toggle(id, false);
    expect(repo.getAll().find(r => r.id === id)!.enabled).toBe(0);

    repo.toggle(id, true);
    expect(repo.getAll().find(r => r.id === id)!.enabled).toBe(1);
  });

  it('upsert creates custom rules', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);

    repo.upsert({
      id: 'custom-test',
      name: 'Test rule',
      description: 'A test rule',
      severity: 'high',
      category: 'custom',
      input_pattern: 'dangerous_command',
      input_flags: 'i',
    });

    const all = repo.getAll();
    const custom = all.find(r => r.id === 'custom-test');
    expect(custom).toBeDefined();
    expect(custom!.is_builtin).toBe(0);
    expect(custom!.name).toBe('Test rule');

    // Should be returned from getEnabled with RegExp
    const enabled = repo.getEnabled();
    const rule = enabled.find(r => r.id === 'custom-test');
    expect(rule).toBeDefined();
    expect(rule!.match.inputPattern).toBeInstanceOf(RegExp);
    expect(rule!.match.inputPattern!.test('some dangerous_command here')).toBe(true);
  });

  it('upsert updates existing custom rules', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);

    repo.upsert({
      id: 'custom-test',
      name: 'Test rule v1',
      input_pattern: 'pattern_v1',
    });

    repo.upsert({
      id: 'custom-test',
      name: 'Test rule v2',
      input_pattern: 'pattern_v2',
    });

    const all = repo.getAll();
    const custom = all.find(r => r.id === 'custom-test');
    expect(custom!.name).toBe('Test rule v2');
    expect(custom!.input_pattern).toBe('pattern_v2');
  });

  it('remove deletes custom rules', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);

    repo.upsert({
      id: 'custom-del',
      name: 'Deletable',
      input_pattern: 'test',
    });

    expect(repo.remove('custom-del')).toBe(true);
    expect(repo.getAll().find(r => r.id === 'custom-del')).toBeUndefined();
  });

  it('remove rejects deleting built-in rules', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);
    repo.seedBuiltins(BUILTIN_RULES);

    expect(() => repo.remove(BUILTIN_RULES[0].id)).toThrow('Cannot delete built-in rule');
  });

  it('remove returns false for non-existent id', () => {
    db = createTestDatabase();
    const repo = new ToolGuardRulesRepository(db);

    expect(repo.remove('non-existent')).toBe(false);
  });
});
