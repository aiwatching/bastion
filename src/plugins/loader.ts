import type Database from 'better-sqlite3';
import type { BastionPlugin } from '../plugin-api/index.js';
import { PLUGIN_API_VERSION } from '../plugin-api/index.js';
import type { Plugin } from './types.js';
import type { PluginEventBus } from './event-bus.js';
import { PluginEventsRepository } from '../storage/repositories/plugin-events.js';
import { createPluginContext } from './context.js';
import { adaptPlugin } from './adapter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('plugin-loader');

export interface ExternalPluginConfig {
  package: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export async function loadExternalPlugins(
  externalConfigs: ExternalPluginConfig[],
  db: Database.Database,
  eventBus: PluginEventBus,
): Promise<{ plugins: Plugin[]; destroyCallbacks: Array<() => Promise<void>> }> {
  const plugins: Plugin[] = [];
  const destroyCallbacks: Array<() => Promise<void>> = [];
  const repo = new PluginEventsRepository(db);
  let priorityCounter = 50;

  for (const cfg of externalConfigs) {
    if (cfg.enabled === false) {
      log.info('External plugin disabled, skipping', { package: cfg.package });
      continue;
    }

    // Dynamic import
    let mod: Record<string, unknown>;
    try {
      mod = await import(cfg.package);
    } catch (err) {
      log.warn('Failed to import external plugin package', {
        package: cfg.package,
        error: (err as Error).message,
      });
      continue;
    }

    // Find register() export (ESM default or CJS)
    const registerFn = (mod.register ?? (mod.default as Record<string, unknown>)?.register) as
      | (() => { plugins: BastionPlugin[]; version: string })
      | undefined;

    if (typeof registerFn !== 'function') {
      log.warn('External plugin package has no register() export', { package: cfg.package });
      continue;
    }

    // Call register()
    let manifest: { plugins: BastionPlugin[]; version: string };
    try {
      manifest = registerFn();
    } catch (err) {
      log.warn('External plugin register() threw', {
        package: cfg.package,
        error: (err as Error).message,
      });
      continue;
    }

    // Process each plugin from the manifest
    for (const externalPlugin of manifest.plugins) {
      // Validate apiVersion
      if (externalPlugin.apiVersion !== PLUGIN_API_VERSION) {
        log.warn('External plugin apiVersion mismatch, skipping', {
          plugin: externalPlugin.name,
          expected: PLUGIN_API_VERSION,
          got: externalPlugin.apiVersion,
        });
        continue;
      }

      // Create context and call onInit
      const context = createPluginContext(
        externalPlugin.name,
        cfg.config ?? {},
        repo,
        eventBus,
      );

      try {
        if (externalPlugin.onInit) {
          await externalPlugin.onInit(context);
        }
      } catch (err) {
        log.warn('External plugin onInit failed, skipping', {
          plugin: externalPlugin.name,
          error: (err as Error).message,
        });
        continue;
      }

      // Adapt to internal Plugin interface
      const adapted = adaptPlugin(externalPlugin, priorityCounter, repo);
      priorityCounter += 1;
      plugins.push(adapted);

      // Collect destroy callbacks
      if (externalPlugin.onDestroy) {
        destroyCallbacks.push(externalPlugin.onDestroy.bind(externalPlugin));
      }

      log.info('External plugin loaded', {
        plugin: externalPlugin.name,
        version: externalPlugin.version,
        priority: adapted.priority,
      });
    }
  }

  return { plugins, destroyCallbacks };
}
