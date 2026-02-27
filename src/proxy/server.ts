import { createServer, type Server } from 'node:http';
import type Database from 'better-sqlite3';
import type { BastionConfig } from '../config/schema.js';
import type { PluginManager } from '../plugins/index.js';
import type { ConfigManager } from '../config/manager.js';
import { resolveRoute, sendError } from './router.js';
import { forwardRequest } from './forwarder.js';
import { passthroughRequest, detectUpstream } from './passthrough.js';
import type { ProviderConfig } from './providers/index.js';
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
  getPluginState?: (pluginName: string, key: string) => unknown | undefined,
): Server {
  // Set up API router if we have both db and configManager
  const apiRouter = db && configManager
    ? createApiRouter(db, configManager, pluginManager, getPluginState)
    : null;

  const server = createServer(async (req, res) => {
    // Layer 1: Health check
    if (handleHealthCheck(req, res)) return;

    // Dashboard
    const dashPath = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && (dashPath === '/dashboard' || dashPath === '/dashboard/')) {
      serveDashboard(res);
      return;
    }

    // Auth check for /api/* routes
    if (req.url?.startsWith('/api/') && configManager) {
      const authCfg = configManager.get().server.auth;
      if (authCfg?.enabled !== false && authCfg?.token) {
        const excluded = (authCfg.excludePaths ?? []).some(p => req.url!.startsWith(p));
        if (!excluded) {
          const authHeader = req.headers['authorization'] as string | undefined;
          const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
          if (token !== authCfg.token) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
        }
      }
    }

    // API routes (GET, PUT)
    if (apiRouter && (req.url?.startsWith('/api/') ?? false)) {
      if (apiRouter(req, res)) return;
    }

    // Route to known provider path (exclude messaging providers in direct HTTP mode)
    const route = resolveRoute(req, { excludeMessaging: true });

    // If scanMethods is configured and non-empty, only scan listed methods
    const scanMethods = config.server.scanMethods ?? [];
    if (scanMethods.length > 0 && !scanMethods.includes(req.method ?? '')) {
      passthroughRequest(req, res, config.timeouts.upstream);
      return;
    }

    // For direct HTTP mode, read session from X-Bastion-Session header
    const sessionId = req.headers['x-bastion-session'] as string | undefined;

    // Determine provider and upstream URL — use route if matched,
    // otherwise create fallback provider so unmatched paths (e.g. GET /v1/models)
    // still go through the plugin pipeline for audit/DLP scanning
    let provider: ProviderConfig;
    let upstreamUrl: string;

    if (route) {
      provider = route.provider;
      upstreamUrl = route.upstreamUrl;
    } else {
      const upstream = detectUpstream(req.headers);
      upstreamUrl = upstream + (req.url ?? '/');
      const hostname = new URL(upstream).hostname;
      provider = {
        name: hostname.replace(/\./g, '-'),
        baseUrl: upstream,
        authHeader: '',
        transformHeaders(headers: Record<string, string>): Record<string, string> {
          const result: Record<string, string> = {};
          for (const [key, value] of Object.entries(headers)) {
            const lower = key.toLowerCase();
            if (lower !== 'host' && lower !== 'connection' && lower !== 'transfer-encoding') {
              result[key] = value;
            }
          }
          return result;
        },
        extractModel(): string { return hostname; },
        extractUsage(): { inputTokens: number; outputTokens: number } {
          return { inputTokens: 0, outputTokens: 0 };
        },
      };
    }

    try {
      await forwardRequest(req, res, {
        provider,
        upstreamUrl,
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
