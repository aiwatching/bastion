import { loadConfig } from './config/index.js';
import { ConfigManager } from './config/manager.js';
import { setLogLevel } from './utils/logger.js';
import { createLogger } from './utils/logger.js';
import { getDatabase, closeDatabase } from './storage/database.js';
import { PluginManager } from './plugins/index.js';
import { createMetricsCollectorPlugin } from './plugins/builtin/metrics-collector.js';
import { createDlpScannerPlugin } from './plugins/builtin/dlp-scanner.js';
import { createTokenOptimizerPlugin } from './plugins/builtin/token-optimizer.js';
import { createAuditLoggerPlugin } from './plugins/builtin/audit-logger.js';
import { createToolGuardPlugin } from './plugins/builtin/tool-guard.js';
import { registerAnthropicProvider } from './proxy/providers/anthropic.js';
import { registerOpenAIProvider } from './proxy/providers/openai.js';
import { registerGeminiProvider } from './proxy/providers/gemini.js';
import { registerClaudeWebProvider } from './proxy/providers/claude-web.js';
import { registerMessagingProviders } from './proxy/providers/messaging.js';
import { createProxyServer, startServer } from './proxy/server.js';
import { writePidFile } from './cli/daemon.js';
import { getCACertPath } from './proxy/certs.js';
import { updateSemanticConfig } from './dlp/semantics.js';
import { RequestsRepository } from './storage/repositories/requests.js';
import { DlpEventsRepository } from './storage/repositories/dlp-events.js';
import { OptimizerEventsRepository } from './storage/repositories/optimizer-events.js';
import { SessionsRepository } from './storage/repositories/sessions.js';
import { AuditLogRepository } from './storage/repositories/audit-log.js';
import { ToolCallsRepository } from './storage/repositories/tool-calls.js';
import { getVersion } from './version.js';

const log = createLogger('main');

export async function startGateway(): Promise<void> {
  // Load configuration
  const config = loadConfig();
  setLogLevel(config.logging.level);

  const version = getVersion();
  log.info('Starting Bastion AI Gateway', { version });

  // Initialize config manager for runtime updates
  const configManager = new ConfigManager(config);

  // Apply initial semantic config + listen for changes
  if (config.plugins.dlp.semantics) {
    updateSemanticConfig(config.plugins.dlp.semantics);
  }
  configManager.onChange((c) => {
    if (c.plugins.dlp.semantics) updateSemanticConfig(c.plugins.dlp.semantics);
  });

  // Initialize database
  const db = getDatabase();

  // Register providers
  registerAnthropicProvider();
  registerOpenAIProvider();
  registerGeminiProvider();
  registerClaudeWebProvider();
  registerMessagingProviders();

  // Initialize plugin manager — register all plugins, disable those not enabled
  const pluginManager = new PluginManager(config.timeouts.plugin);

  pluginManager.register(createMetricsCollectorPlugin(db));
  if (!config.plugins.metrics.enabled) pluginManager.disable('metrics-collector');

  pluginManager.register(createDlpScannerPlugin(db, {
    action: config.plugins.dlp.action,
    patterns: config.plugins.dlp.patterns,
    remotePatterns: config.plugins.dlp.remotePatterns,
    aiValidation: config.plugins.dlp.aiValidation,
    getAction: () => configManager.get().plugins.dlp.action,
  }));
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
  }));
  if (!config.plugins.toolGuard?.enabled) pluginManager.disable('tool-guard');

  // Create and start server
  const server = createProxyServer(config, pluginManager, () => {
    closeDatabase();
  }, db, configManager);

  await startServer(server, config);

  // Write PID file
  writePidFile(process.pid);

  // Centralized data retention purge
  const requestsRepo = new RequestsRepository(db);
  const dlpEventsRepo = new DlpEventsRepository(db);
  const optimizerEventsRepo = new OptimizerEventsRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const auditLogRepo = new AuditLogRepository(db);
  const toolCallsRepo = new ToolCallsRepository(db);

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
      if (total > 0) log.info('Data retention purge completed', { purged: total });
    } catch (err) {
      log.warn('Data retention purge failed', { error: (err as Error).message });
    }
  }

  // Run immediately on startup, then every hour
  runPurge();
  const purgeInterval = setInterval(runPurge, 60 * 60 * 1000);
  purgeInterval.unref();

  const baseUrl = `http://${config.server.host}:${config.server.port}`;
  log.info('Gateway ready', {
    host: config.server.host,
    port: config.server.port,
    plugins: pluginManager.getPlugins().map((p) => p.name),
    dashboard: `${baseUrl}/dashboard`,
    httpsProxy: baseUrl,
    caCert: getCACertPath(),
  });
}

// Auto-start if run directly (daemon mode)
if (process.env.BASTION_DAEMON === '1' || process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  // Only auto-start when this file is the entry point (not imported from CLI)
  const isCLI = process.argv.some((a) => a.includes('cli'));
  if (!isCLI) {
    startGateway().catch((err) => {
      log.error('Failed to start gateway', { error: (err as Error).message });
      process.exit(1);
    });
  }
}
