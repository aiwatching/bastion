import type { Server } from 'node:http';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { createLogger } from '../utils/logger.js';

const log = createLogger('safety');

/**
 * Five-layer safety net:
 * 1. Health check endpoint
 * 2. Graceful shutdown
 * 3. Uncaught exception handler
 * 4. Unhandled rejection handler
 * 5. Process signal handlers
 */

export function handleHealthCheck(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage().rss,
      pid: process.pid,
    }));
    return true;
  }
  return false;
}

export function setupGracefulShutdown(server: Server, cleanup: () => void): void {
  let isShuttingDown = false;

  const shutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info('Received shutdown signal', { signal });

    server.close(() => {
      log.info('Server closed');
      cleanup();
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      log.error('Forced shutdown after timeout');
      cleanup();
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
    // Continue running — fail-open philosophy
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
    // Continue running — fail-open philosophy
  });
}
