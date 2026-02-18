import type { IncomingMessage, ServerResponse } from 'node:http';
import { getProvider, type ProviderConfig } from './providers/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('router');

export interface RouteResult {
  provider: ProviderConfig;
  pathPrefix: string;
  upstreamUrl: string;
}

export function resolveRoute(req: IncomingMessage): RouteResult | null {
  const path = req.url ?? '/';
  const match = getProvider(path);

  if (!match) {
    log.warn('No provider matched', { path });
    return null;
  }

  const upstreamUrl = match.provider.baseUrl + path;
  return {
    provider: match.provider,
    pathPrefix: match.pathPrefix,
    upstreamUrl,
  };
}

export function sendError(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'gateway_error' } }));
}
