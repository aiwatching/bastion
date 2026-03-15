import { describe, it, expect, afterEach } from 'vitest';
import { AgentsRepository } from '../../../src/storage/repositories/agents.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import type Database from 'better-sqlite3';

describe('AgentsRepository', () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  it('insert + get', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({
      id: 'agent-1',
      name: 'test-agent',
      description: 'A test agent',
      owner: 'alice',
      trust_level: 'standard',
    });

    const agent = repo.get('agent-1');
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe('test-agent');
    expect(agent!.description).toBe('A test agent');
    expect(agent!.owner).toBe('alice');
    expect(agent!.trust_level).toBe('standard');
    expect(agent!.status).toBe('active');
    expect(agent!.request_count).toBe(0);
    expect(agent!.total_cost_usd).toBe(0);
  });

  it('getByName', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'agent-1', name: 'my-agent' });

    const agent = repo.getByName('my-agent');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('agent-1');
  });

  it('getByName returns null for unknown', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    expect(repo.getByName('nonexistent')).toBeNull();
  });

  it('update fields', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'agent-1', name: 'orig' });
    const updated = repo.update('agent-1', {
      description: 'Updated desc',
      trust_level: 'privileged',
      tool_scope: ['bash', 'read'],
    });

    expect(updated).toBe(true);
    const agent = repo.get('agent-1');
    expect(agent!.description).toBe('Updated desc');
    expect(agent!.trust_level).toBe('privileged');
    expect(JSON.parse(agent!.tool_scope!)).toEqual(['bash', 'read']);
  });

  it('update returns false for unknown id', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    expect(repo.update('nonexistent', { description: 'x' })).toBe(false);
  });

  it('setStatus', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'agent-1', name: 'a' });
    repo.setStatus('agent-1', 'suspended');
    expect(repo.get('agent-1')!.status).toBe('suspended');

    repo.setStatus('agent-1', 'active');
    expect(repo.get('agent-1')!.status).toBe('active');

    repo.setStatus('agent-1', 'revoked');
    expect(repo.get('agent-1')!.status).toBe('revoked');
  });

  it('updateStats atomically increments', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'agent-1', name: 'a' });
    repo.updateStats('agent-1', { tokens: 100, cost: 0.01 });
    repo.updateStats('agent-1', { tokens: 200, cost: 0.02 });

    const agent = repo.get('agent-1');
    expect(agent!.request_count).toBe(2);
    expect(agent!.total_tokens).toBe(300);
    expect(agent!.total_cost_usd).toBeCloseTo(0.03);
    expect(agent!.last_seen_at).not.toBeNull();
  });

  it('getAll and getActive', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'a1', name: 'active-1' });
    repo.insert({ id: 'a2', name: 'active-2' });
    repo.insert({ id: 'a3', name: 'suspended-1' });
    repo.setStatus('a3', 'suspended');

    expect(repo.getAll()).toHaveLength(3);
    expect(repo.getActive()).toHaveLength(2);
  });

  it('tool_scope stored as JSON', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'a1', name: 'scoped', tool_scope: ['bash', 'file_read'] });

    const agent = repo.get('a1');
    expect(agent!.tool_scope).not.toBeNull();
    expect(JSON.parse(agent!.tool_scope!)).toEqual(['bash', 'file_read']);
  });

  it('null tool_scope means all allowed', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'a1', name: 'unscoped' });

    const agent = repo.get('a1');
    expect(agent!.tool_scope).toBeNull();
  });

  it('purgeOlderThan only removes revoked agents', () => {
    db = createTestDatabase();
    const repo = new AgentsRepository(db);

    repo.insert({ id: 'a1', name: 'active-old' });
    repo.insert({ id: 'a2', name: 'revoked-old' });
    repo.setStatus('a2', 'revoked');

    // Set last_seen to 48 hours ago
    repo.touch('a1');
    repo.touch('a2');
    db.prepare("UPDATE agents SET last_seen_at = datetime('now', '-48 hours') WHERE id IN ('a1', 'a2')").run();

    const purged = repo.purgeOlderThan(24);
    expect(purged).toBe(1); // Only revoked agent is purged
    expect(repo.get('a1')).not.toBeNull(); // Active agent preserved
    expect(repo.get('a2')).toBeNull(); // Revoked agent removed
  });
});
