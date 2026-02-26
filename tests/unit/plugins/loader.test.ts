import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadExternalPlugins } from '../../../src/plugins/loader.js';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import { PLUGIN_API_VERSION } from '../../../src/plugin-api/index.js';
import type { BastionPlugin, PluginContext } from '../../../src/plugin-api/index.js';
import type Database from 'better-sqlite3';

// We use vi.doMock to simulate dynamic import of plugin packages

describe('loadExternalPlugins', () => {
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

  it('loads a valid external plugin successfully', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    // Mock dynamic import
    vi.doMock('fake-plugin-pkg', () => ({
      register: () => ({
        plugins: [makePlugin()],
        version: '1.0.0',
      }),
    }));

    const { plugins, destroyCallbacks } = await loadExternalPlugins(
      [{ package: 'fake-plugin-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe('test-plugin');
    expect(plugins[0].priority).toBe(50);
    expect(destroyCallbacks).toHaveLength(0);
  });

  it('skips disabled plugins', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    const { plugins } = await loadExternalPlugins(
      [{ package: 'whatever', enabled: false }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(0);
  });

  it('skips packages with no register export', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('no-register-pkg', () => {
      return { register: undefined, default: undefined, somethingElse: true };
    });

    const { plugins } = await loadExternalPlugins(
      [{ package: 'no-register-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(0);
  });

  it('skips plugins with mismatched apiVersion', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('bad-version-pkg', () => ({
      register: () => ({
        plugins: [makePlugin({ apiVersion: 999 })],
        version: '1.0.0',
      }),
    }));

    const { plugins } = await loadExternalPlugins(
      [{ package: 'bad-version-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(0);
  });

  it('handles import errors gracefully', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    // Non-existent package will fail to import
    const { plugins } = await loadExternalPlugins(
      [{ package: 'nonexistent-package-xyz-12345', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(0);
  });

  it('skips plugin when onInit fails', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('init-fail-pkg', () => ({
      register: () => ({
        plugins: [makePlugin({
          async onInit() { throw new Error('init boom'); },
        })],
        version: '1.0.0',
      }),
    }));

    const { plugins } = await loadExternalPlugins(
      [{ package: 'init-fail-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(0);
  });

  it('collects onDestroy callbacks', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();
    const destroyFn = vi.fn();

    vi.doMock('destroy-pkg', () => ({
      register: () => ({
        plugins: [makePlugin({
          async onDestroy() { destroyFn(); },
        })],
        version: '1.0.0',
      }),
    }));

    const { destroyCallbacks } = await loadExternalPlugins(
      [{ package: 'destroy-pkg', enabled: true }],
      db,
      bus,
    );

    expect(destroyCallbacks).toHaveLength(1);
    await destroyCallbacks[0]();
    expect(destroyFn).toHaveBeenCalledOnce();
  });

  it('assigns incrementing priorities starting from 50', async () => {
    db = createTestDatabase();
    const bus = new PluginEventBus();

    vi.doMock('multi-pkg', () => ({
      register: () => ({
        plugins: [
          makePlugin({ name: 'p1' }),
          makePlugin({ name: 'p2' }),
        ],
        version: '1.0.0',
      }),
    }));

    const { plugins } = await loadExternalPlugins(
      [{ package: 'multi-pkg', enabled: true }],
      db,
      bus,
    );

    expect(plugins).toHaveLength(2);
    expect(plugins[0].priority).toBe(50);
    expect(plugins[1].priority).toBe(51);
  });
});
