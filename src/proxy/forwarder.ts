import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProviderConfig } from './providers/index.js';
import type { PluginManager } from '../plugins/index.js';
import type { RequestContext, ResponseCompleteContext } from '../plugins/types.js';
import { SSEParser, parseSSEData } from './streaming.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('forwarder');

export interface ForwardOptions {
  provider: ProviderConfig;
  upstreamUrl: string;
  upstreamTimeout: number;
  pluginManager: PluginManager;
}

function bufferBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ForwardOptions,
): Promise<RequestContext> {
  const { provider, upstreamUrl, upstreamTimeout, pluginManager } = options;
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  // Buffer the request body
  const rawBody = await bufferBody(req);
  let bodyStr = rawBody.toString('utf-8');
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = JSON.parse(bodyStr);
  } catch {
    // Not JSON, use as-is
  }

  const model = provider.extractModel(parsedBody);
  const isStreaming = Boolean(parsedBody.stream);

  // Build request context
  const requestContext: RequestContext = {
    id: requestId,
    provider: provider.name,
    model,
    method: req.method ?? 'POST',
    path: req.url ?? '/',
    headers: req.headers as Record<string, string>,
    body: bodyStr,
    parsedBody,
    isStreaming,
    startTime,
  };

  // Run onRequest plugins
  const pluginResult = await pluginManager.runOnRequest(requestContext);

  // If a plugin short-circuited with a response (e.g., cache hit)
  if (pluginResult.shortCircuit) {
    const cached = pluginResult.shortCircuit;
    res.writeHead(cached.statusCode, cached.headers);
    res.end(cached.body);
    return requestContext;
  }

  // If a plugin blocked the request (e.g., DLP)
  if (pluginResult.blocked) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: pluginResult.blocked.reason,
        type: 'gateway_blocked',
      },
    }));
    return requestContext;
  }

  // Use modified body if plugins changed it
  if (pluginResult.modifiedBody) {
    bodyStr = pluginResult.modifiedBody;
  }

  // Forward to upstream
  const url = new URL(upstreamUrl);
  const isHttps = url.protocol === 'https:';
  const outgoingHeaders = provider.transformHeaders(req.headers as Record<string, string>);
  outgoingHeaders['host'] = url.host;
  outgoingHeaders['content-length'] = Buffer.byteLength(bodyStr).toString();

  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise<RequestContext>((resolve) => {
    const upstreamReq = makeRequest(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: req.method,
        headers: outgoingHeaders,
        timeout: upstreamTimeout,
      },
      (upstreamRes) => {
        const statusCode = upstreamRes.statusCode ?? 500;

        // Copy upstream response headers
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
          if (value) responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
        }

        res.writeHead(statusCode, responseHeaders);

        if (isStreaming) {
          handleStreamingResponse(upstreamRes, res, requestContext, pluginManager, provider, startTime)
            .then(() => resolve(requestContext));
        } else {
          handleBufferedResponse(upstreamRes, res, requestContext, pluginManager, provider, startTime)
            .then(() => resolve(requestContext));
        }
      },
    );

    upstreamReq.on('error', (err) => {
      log.error('Upstream request failed', { error: err.message, provider: provider.name });
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Upstream request failed', type: 'gateway_error' },
        }));
      }
      resolve(requestContext);
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Upstream request timed out', type: 'gateway_error' },
        }));
      }
      resolve(requestContext);
    });

    upstreamReq.write(bodyStr);
    upstreamReq.end();
  });
}

async function handleStreamingResponse(
  upstreamRes: IncomingMessage,
  clientRes: ServerResponse,
  context: RequestContext,
  pluginManager: PluginManager,
  provider: ProviderConfig,
  startTime: number,
): Promise<void> {
  let fullResponseData = '';
  const sseEvents: Record<string, unknown>[] = [];

  const parser = new SSEParser((event) => {
    const data = parseSSEData(event);
    if (data) {
      sseEvents.push(data);
    }
  });

  return new Promise<void>((resolve) => {
    upstreamRes.on('data', (chunk: Buffer) => {
      // Forward raw bytes unmodified
      clientRes.write(chunk);
      // Parse for inspection only
      parser.feed(chunk.toString('utf-8'));
      fullResponseData += chunk.toString('utf-8');
    });

    upstreamRes.on('end', async () => {
      parser.flush();
      clientRes.end();

      const latencyMs = Date.now() - startTime;

      // Extract usage from the last SSE event (often contains usage summary)
      let usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      for (const event of sseEvents.reverse()) {
        const extracted = provider.extractUsage(event);
        if (extracted.inputTokens > 0 || extracted.outputTokens > 0) {
          usage = {
            inputTokens: extracted.inputTokens,
            outputTokens: extracted.outputTokens,
            cacheCreationTokens: extracted.cacheCreationTokens ?? 0,
            cacheReadTokens: extracted.cacheReadTokens ?? 0,
          };
          break;
        }
      }

      const completeContext: ResponseCompleteContext = {
        request: context,
        statusCode: upstreamRes.statusCode ?? 200,
        body: fullResponseData,
        parsedBody: null,
        usage,
        latencyMs,
        isStreaming: true,
      };

      await pluginManager.runOnResponseComplete(completeContext);
      resolve();
    });

    upstreamRes.on('error', () => {
      clientRes.end();
      resolve();
    });
  });
}

async function handleBufferedResponse(
  upstreamRes: IncomingMessage,
  clientRes: ServerResponse,
  context: RequestContext,
  pluginManager: PluginManager,
  provider: ProviderConfig,
  startTime: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const chunks: Buffer[] = [];

    upstreamRes.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    upstreamRes.on('end', async () => {
      const body = Buffer.concat(chunks);
      // Forward the raw response
      clientRes.write(body);
      clientRes.end();

      const latencyMs = Date.now() - startTime;

      let parsedBody: Record<string, unknown> | null = null;
      try {
        parsedBody = JSON.parse(body.toString('utf-8'));
      } catch {
        // Not JSON
      }

      const usage = parsedBody
        ? provider.extractUsage(parsedBody)
        : { inputTokens: 0, outputTokens: 0 };

      const completeContext: ResponseCompleteContext = {
        request: context,
        statusCode: upstreamRes.statusCode ?? 200,
        body: body.toString('utf-8'),
        parsedBody,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheCreationTokens: usage.cacheCreationTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
        },
        latencyMs,
        isStreaming: false,
      };

      await pluginManager.runOnResponseComplete(completeContext);
      resolve();
    });

    upstreamRes.on('error', () => {
      clientRes.end();
      resolve();
    });
  });
}
