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
import { registerAnthropicProvider } from './proxy/providers/anthropic.js';
import { registerOpenAIProvider } from './proxy/providers/openai.js';
import { registerGeminiProvider } from './proxy/providers/gemini.js';
import { createProxyServer, startServer } from './proxy/server.js';
import { writePidFile } from './cli/daemon.js';
import { getCACertPath } from './proxy/certs.js';

const log = createLogger('main');

export async function startGateway(): Promise<void> {
  // Load configuration
  const config = loadConfig();
  setLogLevel(config.logging.level);

  log.info('Starting Bastion AI Gateway');

  // Initialize config manager for runtime updates
  const configManager = new ConfigManager(config);

  // Initialize database
  const db = getDatabase();

  // Register providers
  registerAnthropicProvider();
  registerOpenAIProvider();
  registerGeminiProvider();

  // Initialize plugin manager
  const pluginManager = new PluginManager(config.timeouts.plugin);

  if (config.plugins.metrics.enabled) {
    pluginManager.register(createMetricsCollectorPlugin(db));
  }

  if (config.plugins.dlp.enabled) {
    pluginManager.register(createDlpScannerPlugin(db, {
      action: config.plugins.dlp.action,
      patterns: config.plugins.dlp.patterns,
    }));
  }

  if (config.plugins.optimizer.enabled) {
    pluginManager.register(createTokenOptimizerPlugin(db, {
      cache: config.plugins.optimizer.cache,
      trimWhitespace: config.plugins.optimizer.trimWhitespace,
      reorderForCache: config.plugins.optimizer.reorderForCache,
    }));
  }

  if (config.plugins.audit?.enabled) {
    pluginManager.register(createAuditLoggerPlugin(db, {
      retentionHours: config.plugins.audit.retentionHours,
    }));
  }

  // Create and start server
  const server = createProxyServer(config, pluginManager, () => {
    closeDatabase();
  }, db, configManager);

  await startServer(server, config);

  // Write PID file
  writePidFile(process.pid);

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
