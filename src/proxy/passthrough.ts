import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '../utils/logger.js';

const log = createLogger('passthrough');

/**
 * Transparent passthrough: forward any unrecognized request to the
 * upstream provider without plugin processing. This ensures auth flows,
 * token exchanges, and other non-LLM endpoints work correctly when
 * ANTHROPIC_BASE_URL / OPENAI_BASE_URL points to Bastion.
 */

const UPSTREAM_MAP: Record<string, string> = {
  'x-api-key': 'https://api.anthropic.com',
  'anthropic-version': 'https://api.anthropic.com',
  'authorization': 'https://api.openai.com',
  'x-goog-api-key': 'https://generativelanguage.googleapis.com',
};

export function detectUpstream(headers: Record<string, string | string[] | undefined>): string {
  for (const [header, upstream] of Object.entries(UPSTREAM_MAP)) {
    if (headers[header]) return upstream;
  }
  // Default to Anthropic (most common use case)
  return 'https://api.anthropic.com';
}

export function passthroughRequest(
  req: IncomingMessage,
  res: ServerResponse,
  timeout: number,
): void {
  const upstream = detectUpstream(req.headers);
  const upstreamUrl = new URL(req.url ?? '/', upstream);
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  log.info('Passthrough', { method: req.method, path: req.url, upstream, auth: req.headers['authorization']?.slice(0, 20) });

  // Copy headers, replace host
  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  headers['host'] = upstreamUrl.host;
  delete headers['connection'];

  const upstreamReq = makeRequest(
    {
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (isHttps ? 443 : 80),
      path: upstreamUrl.pathname + upstreamUrl.search,
      method: req.method,
      headers,
      timeout,
    },
    (upstreamRes) => {
      log.info('Passthrough response', { path: req.url, status: upstreamRes.statusCode });
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on('error', (err) => {
    log.error('Passthrough failed', { error: err.message });
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

  // Pipe request body
  req.pipe(upstreamReq);
}
