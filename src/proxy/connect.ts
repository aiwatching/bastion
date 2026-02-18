import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import * as tls from 'node:tls';
import * as net from 'node:net';
import type { PluginManager } from '../plugins/index.js';
import type { BastionConfig } from '../config/schema.js';
import { ensureCA, getHostCert, getCACertPath } from './certs.js';
import { resolveRoute, sendError } from './router.js';
import { forwardRequest } from './forwarder.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('connect');

// API domains to MITM intercept — only these get decrypted
const INTERCEPT_HOSTS = new Set([
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
]);

/**
 * Attach CONNECT handler to an existing HTTP server.
 * - API hosts: MITM decrypt → plugin pipeline → forward to real upstream
 * - All other hosts: plain TCP tunnel (no inspection)
 */
export function setupConnectHandler(
  server: net.Server,
  config: BastionConfig,
  pluginManager: PluginManager,
): void {
  const ca = ensureCA();

  server.on('connect', (req: IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    const [hostname, portStr] = (req.url ?? '').split(':');
    const port = parseInt(portStr, 10) || 443;

    log.info('CONNECT', { hostname, port, intercept: INTERCEPT_HOSTS.has(hostname) });

    if (INTERCEPT_HOSTS.has(hostname)) {
      handleMITM(hostname, port, clientSocket, head, ca, config, pluginManager);
    } else {
      handleTunnel(hostname, port, clientSocket, head);
    }
  });

  log.info('CONNECT handler registered', {
    interceptHosts: [...INTERCEPT_HOSTS],
    caCert: getCACertPath(),
  });
}

/**
 * Plain TCP tunnel — no inspection, no modification.
 * Used for OAuth flows, browser traffic, etc.
 */
function handleTunnel(hostname: string, port: number, clientSocket: net.Socket, head: Buffer): void {
  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    log.error('Tunnel error', { hostname, error: err.message });
    clientSocket.end();
  });

  clientSocket.on('error', () => {
    serverSocket.end();
  });

  clientSocket.on('close', () => {
    serverSocket.end();
  });
}

/**
 * MITM interception for API hosts.
 * 1. Accept TLS from client using host cert signed by our CA
 * 2. Decrypt the HTTP request
 * 3. Run through plugin pipeline (DLP, metrics, optimizer)
 * 4. Forward to real upstream
 */
function handleMITM(
  hostname: string,
  port: number,
  clientSocket: net.Socket,
  head: Buffer,
  ca: { key: string; cert: string },
  config: BastionConfig,
  pluginManager: PluginManager,
): void {
  const hostCert = getHostCert(hostname);

  // Tell client the tunnel is established
  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

  // Wrap client socket with TLS (we act as the target server)
  const tlsSocket = new tls.TLSSocket(clientSocket, {
    isServer: true,
    key: hostCert.key,
    cert: hostCert.cert,
  });

  // Create a per-connection HTTP server to parse the decrypted request
  const handler = createMITMRequestHandler(hostname, config, pluginManager);
  const fakeServer = createHttpServer(handler);

  // Inject the TLS socket as a "connection" to the HTTP server
  fakeServer.emit('connection', tlsSocket);

  if (head.length > 0) {
    tlsSocket.unshift(head);
  }

  tlsSocket.on('error', (err) => {
    log.debug('MITM TLS error', { hostname, error: err.message });
  });

  clientSocket.on('error', () => {
    tlsSocket.destroy();
  });

  clientSocket.on('close', () => {
    fakeServer.close();
  });
}

/**
 * Create a request handler for MITM-intercepted connections.
 * Knows the target hostname, so non-provider paths are forwarded directly.
 */
function createMITMRequestHandler(
  hostname: string,
  config: BastionConfig,
  pluginManager: PluginManager,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    log.info('MITM request', { method: req.method, hostname, path: req.url });

    // Try to match a known provider route
    const route = resolveRoute(req);

    if (route && req.method === 'POST') {
      // Known API endpoint — run through plugin pipeline
      try {
        await forwardRequest(req, res, {
          provider: route.provider,
          upstreamUrl: route.upstreamUrl,
          upstreamTimeout: config.timeouts.upstream,
          pluginManager,
        });
      } catch (err) {
        log.error('MITM forward failed', { error: (err as Error).message });
        if (!res.headersSent) {
          sendError(res, 500, 'Internal gateway error');
        }
      }
    } else {
      // Not a known provider path — forward directly to the real host
      directForward(req, res, hostname, config.timeouts.upstream);
    }
  };
}

/**
 * Forward a request directly to a known hostname via HTTPS.
 * Used for non-API-endpoint requests on API domains (e.g., model listing, health checks).
 */
function directForward(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  timeout: number,
): void {
  const path = req.url ?? '/';

  // Copy headers, fix host
  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  headers['host'] = hostname;
  delete headers['connection'];

  const upstreamReq = httpsRequest(
    {
      hostname,
      port: 443,
      path,
      method: req.method,
      headers,
      timeout,
    },
    (upstreamRes) => {
      log.info('MITM direct response', { hostname, path, status: upstreamRes.statusCode });
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on('error', (err) => {
    log.error('MITM direct forward failed', { hostname, error: err.message });
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Upstream request failed', type: 'gateway_error' } }));
    }
  });

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Upstream request timed out', type: 'gateway_error' } }));
    }
  });

  req.pipe(upstreamReq);
}
