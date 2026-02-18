import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import yaml from 'js-yaml';
import type { BastionConfig } from './schema.js';
import { paths } from './paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config-manager');

type ConfigChangeListener = (config: BastionConfig) => void;

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export class ConfigManager {
  private config: BastionConfig;
  private listeners: ConfigChangeListener[] = [];

  constructor(initialConfig: BastionConfig) {
    this.config = initialConfig;
  }

  get(): BastionConfig {
    return this.config;
  }

  update(partial: Record<string, unknown>): BastionConfig {
    this.config = deepMerge(
      this.config as unknown as Record<string, unknown>,
      partial,
    ) as unknown as BastionConfig;

    // Persist to user config file
    try {
      mkdirSync(dirname(paths.configFile), { recursive: true });
      writeFileSync(paths.configFile, yaml.dump(this.config), 'utf-8');
      log.info('Config persisted', { path: paths.configFile });
    } catch (err) {
      log.warn('Failed to persist config', { error: (err as Error).message });
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(this.config);
      } catch (err) {
        log.warn('Config change listener error', { error: (err as Error).message });
      }
    }

    return this.config;
  }

  onChange(callback: ConfigChangeListener): void {
    this.listeners.push(callback);
  }
}
