import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { loadConfig } from '../config/index.js';
import { ConfigManager } from '../config/manager.js';
import type { BastionConfig } from '../config/schema.js';
import { setLogLevel, createLogger } from '../utils/logger.js';
import { getDatabase, closeDatabase } from '../storage/database.js';
import { PluginManager } from '../plugins/index.js';
import { PluginEventBus } from '../plugins/event-bus.js';
import { createMetricsCollectorPlugin } from '../plugins/builtin/metrics-collector.js';
import { createDlpScannerPlugin } from '../plugins/builtin/dlp-scanner.js';
import { createTokenOptimizerPlugin } from '../plugins/builtin/token-optimizer.js';
import { createAuditLoggerPlugin } from '../plugins/builtin/audit-logger.js';
import { createToolGuardPlugin } from '../plugins/builtin/tool-guard.js';
import { registerAnthropicProvider } from '../proxy/providers/anthropic.js';
import { registerOpenAIProvider } from '../proxy/providers/openai.js';
import { registerGeminiProvider } from '../proxy/providers/gemini.js';
import { registerClaudeWebProvider } from '../proxy/providers/claude-web.js';
import { registerMessagingProviders } from '../proxy/providers/messaging.js';
import { createProxyServer, startServer } from '../proxy/server.js';
import { updateSemanticConfig } from '../dlp/semantics.js';
import { RequestsRepository } from '../storage/repositories/requests.js';
import { DlpEventsRepository } from '../storage/repositories/dlp-events.js';
import { OptimizerEventsRepository } from '../storage/repositories/optimizer-events.js';
import { SessionsRepository } from '../storage/repositories/sessions.js';
import { AuditLogRepository } from '../storage/repositories/audit-log.js';
import { ToolCallsRepository } from '../storage/repositories/tool-calls.js';
import { PluginEventsRepository } from '../storage/repositories/plugin-events.js';
import { loadExternalPlugins } from '../plugins/loader.js';
import { getVersion } from '../version.js';

const log = createLogger('bootstrap');

export interface BootstrapOptions {
  configPath?: string;
  configOverrides?: Record<string, unknown>;
  silent?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  port?: number;
  host?: string;
  dbPath?: string;
  skipPidFile?: boolean;
  skipRetention?: boolean;
}

export interface BootstrapResult {
  config: BastionConfig;
  configManager: ConfigManager;
  db: Database.Database;
  pluginManager: PluginManager;
  eventBus: PluginEventBus;
  server: Server;
  destroyCallbacks: Array<() => Promise<void>>;
  purgeInterval: NodeJS.Timeout | null;
  authToken: string | undefined;
}

export async function bootstrap(options?: BootstrapOptions): Promise<BootstrapResult> {
  // Load configuration
  const config = loadConfig(options?.configPath);

  // Apply overrides
  if (options?.configOverrides) {
    deepMergeInto(config as unknown as Record<string, unknown>, options.configOverrides);
  }
  if (options?.port !== undefined) config.server.port = options.port;
  if (options?.host !== undefined) config.server.host = options.host;
  if (options?.logLevel) config.logging.level = options.logLevel;

  setLogLevel(config.logging.level);

  const version = getVersion();
  log.info('Starting Bastion AI Gateway', { version });

  // Initialize config manager for runtime updates
  const configManager = new ConfigManager(config);

  // Auto-generate auth token if auth enabled but no token configured
  let authToken: string | undefined;
  if (config.server.auth?.enabled !== false && !config.server.auth?.token) {
    const token = crypto.randomBytes(32).toString('hex');
    configManager.update({ server: { auth: { token } } });
    authToken = token;
    if (!options?.silent) {
      console.log(`\n  Dashboard token generated: ${token}`);
      console.log('  Set server.auth.token in config.yaml to use a custom token\n');
    }
  } else {
    authToken = config.server.auth?.token;
  }

  // Apply initial semantic config + listen for changes
  if (config.plugins.dlp.semantics) {
    updateSemanticConfig(config.plugins.dlp.semantics);
  }
  configManager.onChange((c) => {
    if (c.plugins.dlp.semantics) updateSemanticConfig(c.plugins.dlp.semantics);
  });

  // Initialize database
  const db = getDatabase(options?.dbPath);

  // Register providers
  registerAnthropicProvider();
  registerOpenAIProvider();
  registerGeminiProvider();
  registerClaudeWebProvider();
  registerMessagingProviders();

  // Initialize event bus (used by API consumers and external plugins)
  const eventBus = new PluginEventBus();

  // Initialize plugin manager
  const pluginManager = new PluginManager(config.timeouts.plugin, config.server.failMode ?? 'open', eventBus);

  pluginManager.register(createMetricsCollectorPlugin(db));
  if (!config.plugins.metrics.enabled) pluginManager.disable('metrics-collector');

  pluginManager.register(createDlpScannerPlugin(db, {
    action: config.plugins.dlp.action,
    patterns: config.plugins.dlp.patterns,
    remotePatterns: config.plugins.dlp.remotePatterns,
    aiValidation: config.plugins.dlp.aiValidation,
    getAction: () => configManager.get().plugins.dlp.action,
    getLocalProvider: () => pluginStateGetter('pi-classifier', 'classifierProvider') as import('../plugin-api/types.js').ClassifierProvider | undefined,
  }, eventBus));
  if (!config.plugins.dlp.enabled) pluginManager.disable('dlp-scanner');

  pluginManager.register(createTokenOptimizerPlugin(db, {
    cache: config.plugins.optimizer.cache,
    cacheTtlSeconds: config.plugins.optimizer.cacheTtlSeconds ?? 300,
    trimWhitespace: config.plugins.optimizer.trimWhitespace,
    reorderForCache: config.plugins.optimizer.reorderForCache,
  }));
  if (!config.plugins.optimizer.enabled) pluginManager.disable('token-optimizer');

  pluginManager.register(createAuditLoggerPlugin(db, {
    rawData: config.plugins.audit?.rawData ?? true,
    rawMaxBytes: config.plugins.audit?.rawMaxBytes ?? 524288,
    summaryMaxBytes: config.plugins.audit?.summaryMaxBytes ?? 1024,
  }));
  if (!config.plugins.audit?.enabled) pluginManager.disable('audit-logger');

  pluginManager.register(createToolGuardPlugin(db, {
    enabled: config.plugins.toolGuard?.enabled ?? true,
    action: config.plugins.toolGuard?.action ?? 'audit',
    recordAll: config.plugins.toolGuard?.recordAll ?? true,
    blockMinSeverity: config.plugins.toolGuard?.blockMinSeverity ?? 'critical',
    alertMinSeverity: config.plugins.toolGuard?.alertMinSeverity ?? 'high',
    alertDesktop: config.plugins.toolGuard?.alertDesktop ?? true,
    alertWebhookUrl: config.plugins.toolGuard?.alertWebhookUrl ?? '',
    getLiveConfig: () => {
      const tg = configManager.get().plugins.toolGuard;
      return {
        action: tg?.action ?? 'audit',
        recordAll: tg?.recordAll ?? true,
        blockMinSeverity: tg?.blockMinSeverity ?? 'critical',
        alertMinSeverity: tg?.alertMinSeverity ?? 'high',
      };
    },
  }, eventBus));
  if (!config.plugins.toolGuard?.enabled) pluginManager.disable('tool-guard');

  // pluginStateGetter is a lazy closure — DLP scanner is created before external plugins,
  // so it captures the getter that gets updated once external plugins are loaded.
  let pluginStateGetter: (pluginName: string, key: string) => unknown | undefined = () => undefined;

  // Load external plugins
  const externalConfigs = config.plugins.external ?? [];
  let destroyCallbacks: Array<() => Promise<void>> = [];
  let getPluginState: (pluginName: string, key: string) => unknown | undefined = () => undefined;
  if (externalConfigs.length > 0) {
    const result = await loadExternalPlugins(externalConfigs, db, eventBus);
    destroyCallbacks = result.destroyCallbacks;
    getPluginState = result.getPluginState;
    pluginStateGetter = result.getPluginState;
    for (const plugin of result.plugins) {
      pluginManager.register(plugin);
    }
  } else {
    log.info('No external plugins configured');
  }

  // Sync failMode changes at runtime
  configManager.onChange((c) => {
    pluginManager.setFailMode(c.server.failMode ?? 'open');
  });

  // Create and start server
  const server = createProxyServer(config, pluginManager, () => {
    for (const cb of destroyCallbacks) cb().catch(() => {});
    closeDatabase();
  }, db, configManager, getPluginState);

  await startServer(server, config);

  // Centralized data retention purge
  let purgeInterval: NodeJS.Timeout | null = null;
  if (!options?.skipRetention) {
    const requestsRepo = new RequestsRepository(db);
    const dlpEventsRepo = new DlpEventsRepository(db);
    const optimizerEventsRepo = new OptimizerEventsRepository(db);
    const sessionsRepo = new SessionsRepository(db);
    const auditLogRepo = new AuditLogRepository(db);
    const toolCallsRepo = new ToolCallsRepository(db);
    const pluginEventsRepo = new PluginEventsRepository(db);

    function runPurge(): void {
      const r = configManager.get().retention;
      try {
        let total = 0;
        total += requestsRepo.purgeOlderThan(r.requestsHours);
        total += dlpEventsRepo.purgeOlderThan(r.dlpEventsHours);
        total += optimizerEventsRepo.purgeOlderThan(r.optimizerEventsHours);
        total += sessionsRepo.purgeOlderThan(r.sessionsHours);
        total += auditLogRepo.purgeOlderThan(r.auditLogHours);
        total += toolCallsRepo.purgeOlderThan(r.toolCallsHours);
        total += pluginEventsRepo.purgeOlderThan(r.pluginEventsHours ?? 720);
        if (total > 0) log.info('Data retention purge completed', { purged: total });
      } catch (err) {
        log.warn('Data retention purge failed', { error: (err as Error).message });
      }
    }

    runPurge();
    purgeInterval = setInterval(runPurge, 60 * 60 * 1000);
    purgeInterval.unref();
  }

  return {
    config: configManager.get(),
    configManager,
    db,
    pluginManager,
    eventBus,
    server,
    destroyCallbacks,
    purgeInterval,
    authToken,
  };
}

/** Simple deep merge — mutates target in-place */
function deepMergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      deepMergeInto(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      target[key] = source[key];
    }
  }
}
