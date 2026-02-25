import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProviderConfig } from './providers/index.js';
import type { PluginManager } from '../plugins/index.js';
import type { RequestContext, ResponseCompleteContext, ResponseInterceptContext } from '../plugins/types.js';
import { SSEParser, parseSSEData } from './streaming.js';
import { StreamingToolGuard } from '../tool-guard/streaming-guard.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('forwarder');

export interface ForwardOptions {
  provider: ProviderConfig;
  upstreamUrl: string;
  upstreamTimeout: number;
  pluginManager: PluginManager;
  sessionId?: string;
  sessionSource?: string;
}

function computeApiKeyHash(headers: Record<string, string>): string | undefined {
  // Check common auth headers
  const authHeader = headers['authorization'] || headers['x-api-key'];
  if (!authHeader) return undefined;
  const key = authHeader.replace(/^Bearer\s+/i, '');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
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
  const { provider, upstreamUrl, upstreamTimeout, pluginManager, sessionId, sessionSource } = options;
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

  const reqHeaders = req.headers as Record<string, string>;
  const apiKeyHash = computeApiKeyHash(reqHeaders);

  // Build request context
  const requestContext: RequestContext = {
    id: requestId,
    provider: provider.name,
    model,
    method: req.method ?? 'POST',
    path: req.url ?? '/',
    headers: reqHeaders,
    body: bodyStr,
    parsedBody,
    isStreaming,
    startTime,
    sessionId,
    sessionSource,
    apiKeyHash,
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

        if (isStreaming) {
          // Streaming: send headers immediately, forward chunks in real-time
          res.writeHead(statusCode, responseHeaders);
          handleStreamingResponse(upstreamRes, res, requestContext, pluginManager, provider, startTime)
            .then(() => resolve(requestContext));
        } else {
          // Non-streaming: buffer response, run onResponse hook, then send
          handleBufferedResponse(upstreamRes, res, statusCode, responseHeaders, requestContext, pluginManager, provider, startTime)
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

  // Streaming tool guard: intercept tool_use SSE blocks when action=block
  const useGuard = Boolean(context._toolGuardStreamBlock);
  const guard = useGuard
    ? new StreamingToolGuard(
        { blockMinSeverity: context._toolGuardStreamBlock!, rules: context._toolGuardRules },
        (data: string) => clientRes.write(data),
      )
    : null;

  // Accumulate raw events for the guard (keyed by parse position)
  let rawEventBuffer = '';

  const parser = new SSEParser((event) => {
    const data = parseSSEData(event);
    if (data) {
      sseEvents.push(data);
    }

    if (guard) {
      // Reconstruct the raw SSE text for this event
      const rawEvent = (event.event ? `event: ${event.event}\n` : '') +
        `data: ${event.data}\n\n`;
      guard.processEvent(rawEvent, data);
    }
  });

  return new Promise<void>((resolve) => {
    upstreamRes.on('data', (chunk: Buffer) => {
      const chunkStr = chunk.toString('utf-8');
      fullResponseData += chunkStr;

      if (guard) {
        // Let the parser drive the guard (events are processed in the SSEParser callback)
        parser.feed(chunkStr);
      } else {
        // No guard: forward raw bytes unmodified, parse for inspection only
        clientRes.write(chunk);
        parser.feed(chunkStr);
      }
    });

    upstreamRes.on('end', async () => {
      parser.flush();
      if (guard) guard.flush();
      clientRes.end();

      // Propagate streaming guard block results to request context
      if (guard && guard.results.length > 0) {
        const blocked = guard.results.filter(r => r.blocked);
        if (blocked.length > 0) {
          context.toolGuardHit = true;
          context.toolGuardFindings = blocked.length;
        }
      }

      const latencyMs = Date.now() - startTime;

      // Extract usage by merging across all SSE events (take max per field).
      // Anthropic splits usage: input_tokens in message_start, output_tokens in message_delta.
      const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      for (const event of sseEvents) {
        const extracted = provider.extractUsage(event);
        if (extracted.inputTokens > usage.inputTokens) usage.inputTokens = extracted.inputTokens;
        if (extracted.outputTokens > usage.outputTokens) usage.outputTokens = extracted.outputTokens;
        if ((extracted.cacheCreationTokens ?? 0) > usage.cacheCreationTokens) usage.cacheCreationTokens = extracted.cacheCreationTokens ?? 0;
        if ((extracted.cacheReadTokens ?? 0) > usage.cacheReadTokens) usage.cacheReadTokens = extracted.cacheReadTokens ?? 0;
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
      if (guard) guard.flush();
      clientRes.end();
      resolve();
    });
  });
}

async function handleBufferedResponse(
  upstreamRes: IncomingMessage,
  clientRes: ServerResponse,
  statusCode: number,
  responseHeaders: Record<string, string>,
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
      let bodyStr = body.toString('utf-8');
      const latencyMs = Date.now() - startTime;

      let parsedBody: Record<string, unknown> | null = null;
      try {
        parsedBody = JSON.parse(bodyStr);
      } catch {
        // Not JSON
      }

      // Run onResponse hook (pre-send interception)
      const interceptContext: ResponseInterceptContext = {
        request: context,
        statusCode,
        headers: responseHeaders,
        body: bodyStr,
        parsedBody,
        isStreaming: false,
      };

      const hookResult = await pluginManager.runOnResponse(interceptContext);

      if (hookResult.blocked) {
        // Block: send error to client instead of the LLM response
        clientRes.writeHead(403, { 'content-type': 'application/json' });
        clientRes.end(JSON.stringify({
          error: {
            message: hookResult.blocked.reason,
            type: 'gateway_response_blocked',
          },
        }));
      } else {
        // Send response (original or modified)
        if (hookResult.modifiedBody) {
          bodyStr = hookResult.modifiedBody;
        }
        // We buffered the response, so set exact content-length and remove chunked encoding
        delete responseHeaders['transfer-encoding'];
        responseHeaders['content-length'] = Buffer.byteLength(bodyStr).toString();
        clientRes.writeHead(statusCode, responseHeaders);
        clientRes.write(bodyStr);
        clientRes.end();
      }

      const usage = parsedBody
        ? provider.extractUsage(parsedBody)
        : { inputTokens: 0, outputTokens: 0 };

      const completeContext: ResponseCompleteContext = {
        request: context,
        statusCode,
        body: bodyStr,
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
