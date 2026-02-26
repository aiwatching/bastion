import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import yaml from 'js-yaml';
import type { BastionConfig } from './schema.js';
import { paths } from './paths.js';

const DEFAULT_CONFIG_PATH = resolve(join(__dirname, '..', '..', 'config', 'default.yaml'));

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

export function loadConfig(overridePath?: string): BastionConfig {
  // Load default config
  const defaultRaw = readFileSync(DEFAULT_CONFIG_PATH, 'utf-8');
  let config = yaml.load(defaultRaw) as Record<string, unknown>;

  // Merge user config if it exists
  const userConfigPath = overridePath ?? paths.configFile;
  if (existsSync(userConfigPath)) {
    const userRaw = readFileSync(userConfigPath, 'utf-8');
    const userConfig = yaml.load(userRaw) as Record<string, unknown>;
    if (userConfig) {
      config = deepMerge(config, userConfig);
    }
  }

  // Apply environment variable overrides
  if (process.env.BASTION_PORT) {
    (config.server as Record<string, unknown>).port = parseInt(process.env.BASTION_PORT, 10);
  }
  if (process.env.BASTION_HOST) {
    (config.server as Record<string, unknown>).host = process.env.BASTION_HOST;
  }
  if (process.env.BASTION_LOG_LEVEL) {
    (config.logging as Record<string, unknown>).level = process.env.BASTION_LOG_LEVEL;
  }
  if (process.env.BASTION_AUTH_TOKEN) {
    const serverObj = config.server as Record<string, unknown>;
    const serverAuth = (serverObj.auth as Record<string, unknown>) ?? {};
    serverAuth.token = process.env.BASTION_AUTH_TOKEN;
    serverObj.auth = serverAuth;
  }

  return config as unknown as BastionConfig;
}
