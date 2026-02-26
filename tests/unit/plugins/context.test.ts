import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPluginContext } from '../../../src/plugins/context.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { PluginEventsRepository } from '../../../src/storage/repositories/plugin-events.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import type Database from 'better-sqlite3';

describe('createPluginContext', () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  it('logger is namespaced to plugin:<name>', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);
    const bus = new PluginEventBus();
    const ctx = createPluginContext('my-plugin', {}, repo, bus);

    // logger should have all four methods
    expect(typeof ctx.logger.debug).toBe('function');
    expect(typeof ctx.logger.info).toBe('function');
    expect(typeof ctx.logger.warn).toBe('function');
    expect(typeof ctx.logger.error).toBe('function');
  });

  it('state is isolated per context instance', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);
    const bus = new PluginEventBus();

    const ctx1 = createPluginContext('plugin-a', {}, repo, bus);
    const ctx2 = createPluginContext('plugin-b', {}, repo, bus);

    ctx1.setPluginState('key', 'value-a');
    ctx2.setPluginState('key', 'value-b');

    expect(ctx1.getPluginState('key')).toBe('value-a');
    expect(ctx2.getPluginState('key')).toBe('value-b');
    expect(ctx1.getPluginState('missing')).toBeUndefined();
  });

  it('db.insertEvent writes to plugin_events table', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);
    const bus = new PluginEventBus();
    const ctx = createPluginContext('test-plugin', {}, repo, bus);

    ctx.db.insertEvent({
      type: 'custom',
      severity: 'info',
      rule: 'test-rule',
      detail: 'something happened',
    });

    const records = repo.getByPlugin('test-plugin');
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe('custom');
    expect(records[0].rule).toBe('test-rule');
  });

  it('emit delegates to shared event bus', () => {
    db = createTestDatabase();
    const repo = new PluginEventsRepository(db);
    const bus = new PluginEventBus();
    const handler = vi.fn();

    const ctx1 = createPluginContext('emitter', {}, repo, bus);
    const ctx2 = createPluginContext('listener', {}, repo, bus);

    ctx2.on('custom:alert', handler);
    ctx1.emit('custom:alert', { level: 'high' });

    expect(handler).toHaveBeenCalledWith({ level: 'high' });
  });
});
