import type { PluginContext, PluginEvent } from '../plugin-api/index.js';
import type { PluginEventBus } from './event-bus.js';
import type { PluginEventsRepository } from '../storage/repositories/plugin-events.js';
import { createLogger } from '../utils/logger.js';

export interface PluginContextInternal extends PluginContext {
  _getState<T>(key: string): T | undefined;
}

export function createPluginContext(
  pluginName: string,
  config: Record<string, unknown>,
  repo: PluginEventsRepository,
  eventBus: PluginEventBus,
): PluginContextInternal {
  const logger = createLogger(`plugin:${pluginName}`);
  const state = new Map<string, unknown>();

  return {
    _getState<T>(key: string): T | undefined {
      return state.get(key) as T | undefined;
    },
    config,
    logger,
    db: {
      insertEvent(event: PluginEvent): void {
        repo.insertEvent(pluginName, null, event);
      },
    },
    getPluginState<T>(key: string): T | undefined {
      return state.get(key) as T | undefined;
    },
    setPluginState<T>(key: string, value: T): void {
      state.set(key, value);
    },
    emit(event: string, data: unknown): void {
      eventBus.emit(event, data);
    },
    on(event: string, handler: (data: unknown) => void): void {
      eventBus.on(event, handler);
    },
  };
}
