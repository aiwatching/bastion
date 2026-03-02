import { bootstrap } from './core/bootstrap.js';
import { writePidFile } from './cli/daemon.js';
import { getCACertPath } from './proxy/certs.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('main');

export async function startGateway(): Promise<void> {
  const result = await bootstrap();

  // Write PID file (CLI/daemon mode only)
  writePidFile(process.pid);

  const baseUrl = `http://${result.config.server.host}:${result.config.server.port}`;
  log.info('Gateway ready', {
    host: result.config.server.host,
    port: result.config.server.port,
    plugins: result.pluginManager.getPlugins().map((p) => p.name),
    dashboard: `${baseUrl}/dashboard`,
    httpsProxy: baseUrl,
    caCert: getCACertPath(),
  });
}

// Re-export public API
export { createServer, ensureCertificate } from './api.js';
export type { BastionServer, BastionServerOptions, CertificateInfo } from './api.js';

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
