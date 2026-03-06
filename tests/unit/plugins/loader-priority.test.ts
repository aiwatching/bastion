import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadExternalPlugins } from '../../../src/plugins/loader.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import { PLUGIN_API_VERSION } from '../../../src/plugin-api/index.js';
import type { BastionPlugin } from '../../../src/plugin-api/index.js';
import type Database from 'better-sqlite3';

describe('loadExternalPlugins: declared priority', () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
    vi.restoreAllMocks();
  });

  function makePlugin(overrides: Partial<BastionPlugin> = {}): BastionPlugin {
    return {
      name: 'test-plugin',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      ...overrides,
    };
  }

  it('uses declared priority when plugin specifies one', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('priority-pkg', () => ({
      register: () => ({
        plugins: [makePlugin({ name: 'declared', priority: 3 })],
        version: '1.0.0',
      }),
    }));

    const { plugins } = await loadExternalPlugins(
      [{ package: 'priority-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe('declared');
    expect(plugins[0].priority).toBe(3);
  });

  it('auto-assigns priority from 50 when not declared', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('no-priority-pkg', () => ({
      register: () => ({
        plugins: [
          makePlugin({ name: 'auto1' }),
          makePlugin({ name: 'auto2' }),
        ],
        version: '1.0.0',
      }),
    }));

    const { plugins } = await loadExternalPlugins(
      [{ package: 'no-priority-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(2);
    expect(plugins[0].priority).toBe(50);
    expect(plugins[1].priority).toBe(51);
  });

  it('mixes declared and auto-assigned priorities', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('mixed-priority-pkg', () => ({
      register: () => ({
        plugins: [
          makePlugin({ name: 'declared', priority: 7 }),
          makePlugin({ name: 'auto' }),
        ],
        version: '1.0.0',
      }),
    }));

    const { plugins } = await loadExternalPlugins(
      [{ package: 'mixed-priority-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(2);
    // Declared plugin keeps its priority
    expect(plugins.find(p => p.name === 'declared')!.priority).toBe(7);
    // Auto plugin gets 50 (counter not incremented by declared plugin)
    expect(plugins.find(p => p.name === 'auto')!.priority).toBe(50);
  });

  it('does not increment counter for plugins with declared priority', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('counter-test-pkg', () => ({
      register: () => ({
        plugins: [
          makePlugin({ name: 'declared1', priority: 5 }),
          makePlugin({ name: 'declared2', priority: 10 }),
          makePlugin({ name: 'auto1' }),
          makePlugin({ name: 'auto2' }),
        ],
        version: '1.0.0',
      }),
    }));

    const { plugins } = await loadExternalPlugins(
      [{ package: 'counter-test-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(4);
    expect(plugins.find(p => p.name === 'declared1')!.priority).toBe(5);
    expect(plugins.find(p => p.name === 'declared2')!.priority).toBe(10);
    expect(plugins.find(p => p.name === 'auto1')!.priority).toBe(50);
    expect(plugins.find(p => p.name === 'auto2')!.priority).toBe(51);
  });
});
