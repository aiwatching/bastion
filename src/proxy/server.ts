import { createServer, type Server } from 'node:http';
import type Database from 'better-sqlite3';
import type { BastionConfig } from '../config/schema.js';
import type { PluginManager } from '../plugins/index.js';
import type { ConfigManager } from '../config/manager.js';
import { resolveRoute, sendError } from './router.js';
import { forwardRequest } from './forwarder.js';
import { passthroughRequest } from './passthrough.js';
import { handleHealthCheck, setupGracefulShutdown } from './safety.js';
import { serveDashboard } from '../dashboard/page.js';
import { createApiRouter } from '../dashboard/api-routes.js';
import { setupConnectHandler } from './connect.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('server');

export function createProxyServer(
  config: BastionConfig,
  pluginManager: PluginManager,
  cleanup: () => void,
  db?: Database.Database,
  configManager?: ConfigManager,
): Server {
  // Set up API router if we have both db and configManager
  const apiRouter = db && configManager
    ? createApiRouter(db, configManager, pluginManager)
    : null;

  const server = createServer(async (req, res) => {
    // Layer 1: Health check
    if (handleHealthCheck(req, res)) return;

    // Dashboard
    if (req.method === 'GET' && (req.url === '/dashboard' || req.url === '/dashboard/')) {
      serveDashboard(res);
      return;
    }

    // API routes (GET, PUT)
    if (apiRouter && (req.url?.startsWith('/api/') ?? false)) {
      if (apiRouter(req, res)) return;
    }

    // Only accept POST requests for provider endpoints
    if (req.method !== 'POST') {
      // Unknown GET/PUT/etc — passthrough to upstream (e.g. auth flows)
      passthroughRequest(req, res, config.timeouts.upstream);
      return;
    }

    // Route to known provider path
    const route = resolveRoute(req);
    if (!route) {
      // Unknown POST path — passthrough to upstream
      passthroughRequest(req, res, config.timeouts.upstream);
      return;
    }

    // For direct HTTP mode, read session from X-Bastion-Session header
    const sessionId = req.headers['x-bastion-session'] as string | undefined;

    try {
      await forwardRequest(req, res, {
        provider: route.provider,
        upstreamUrl: route.upstreamUrl,
        upstreamTimeout: config.timeouts.upstream,
        pluginManager,
        sessionId,
      });
    } catch (err) {
      log.error('Request handling failed', { error: (err as Error).message });
      if (!res.headersSent) {
        sendError(res, 500, 'Internal gateway error');
      }
    }
  });

  setupGracefulShutdown(server, cleanup);

  // Enable HTTPS_PROXY mode (CONNECT handler for MITM on API domains)
  setupConnectHandler(server, config, pluginManager);

  return server;
}

export function startServer(server: Server, config: BastionConfig): Promise<void> {
  return new Promise((resolve) => {
    server.listen(config.server.port, config.server.host, () => {
      log.info('Bastion AI Gateway started', {
        host: config.server.host,
        port: config.server.port,
      });
      resolve();
    });
  });
}
