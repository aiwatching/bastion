import type { Plugin, PluginRequestResult, RequestContext, ResponseCompleteContext } from './types.js';
import { withTimeout, TimeoutError } from '../utils/timeout.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('plugins');

export class PluginManager {
  private plugins: Plugin[] = [];
  private disabledPlugins: Set<string> = new Set();
  private timeoutMs: number;

  constructor(timeoutMs: number = 50) {
    this.timeoutMs = timeoutMs;
  }

  register(plugin: Plugin): void {
    this.plugins.push(plugin);
    this.plugins.sort((a, b) => a.priority - b.priority);
    log.info('Plugin registered', { name: plugin.name, priority: plugin.priority });
  }

  getPlugins(): Plugin[] {
    return [...this.plugins];
  }

  disable(name: string): boolean {
    const plugin = this.plugins.find((p) => p.name === name);
    if (!plugin) return false;
    this.disabledPlugins.add(name);
    log.info('Plugin disabled', { name });
    return true;
  }

  enable(name: string): boolean {
    const existed = this.disabledPlugins.delete(name);
    if (existed) {
      log.info('Plugin enabled', { name });
    }
    return existed;
  }

  isDisabled(name: string): boolean {
    return this.disabledPlugins.has(name);
  }

  async runOnRequest(context: RequestContext): Promise<PluginRequestResult> {
    const result: PluginRequestResult = {};

    for (const plugin of this.plugins) {
      if (!plugin.onRequest || this.disabledPlugins.has(plugin.name)) continue;

      try {
        const pluginResult = await withTimeout(
          plugin.onRequest(context),
          this.timeoutMs,
        );

        if (pluginResult) {
          // Short-circuit takes priority
          if (pluginResult.shortCircuit) {
            log.info('Plugin short-circuited request', { plugin: plugin.name });
            return pluginResult;
          }
          // Block takes second priority
          if (pluginResult.blocked) {
            log.info('Plugin blocked request', { plugin: plugin.name, reason: pluginResult.blocked.reason });
            return pluginResult;
          }
          // Accumulate body modifications
          if (pluginResult.modifiedBody) {
            result.modifiedBody = pluginResult.modifiedBody;
            // Update context body for next plugin
            context.body = pluginResult.modifiedBody;
          }
        }
      } catch (err) {
        if (err instanceof TimeoutError) {
          log.warn('Plugin timed out, skipping', { plugin: plugin.name });
        } else {
          log.warn('Plugin error, skipping', { plugin: plugin.name, error: (err as Error).message });
        }
        // Fail-open: skip this plugin and continue
      }
    }

    return result;
  }

  async runOnResponseComplete(context: ResponseCompleteContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.onResponseComplete || this.disabledPlugins.has(plugin.name)) continue;

      try {
        await withTimeout(
          plugin.onResponseComplete(context),
          this.timeoutMs,
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          log.warn('Plugin onResponseComplete timed out, skipping', { plugin: plugin.name });
        } else {
          log.warn('Plugin onResponseComplete error, skipping', {
            plugin: plugin.name,
            error: (err as Error).message,
          });
        }
      }
    }
  }
}
