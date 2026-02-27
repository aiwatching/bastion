import type { BastionPlugin, ProxyRequest, ProxyResponse, PluginResult } from '../plugin-api/index.js';
import type { Plugin, RequestContext, ResponseInterceptContext, ResponseCompleteContext, PluginRequestResult, PluginResponseResult } from './types.js';
import type { PluginEventsRepository } from '../storage/repositories/plugin-events.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('plugin-adapter');

/** Convert internal RequestContext to public ProxyRequest (strip internal flags) */
export function toProxyRequest(ctx: RequestContext): ProxyRequest {
  return {
    id: ctx.id,
    provider: ctx.provider,
    model: ctx.model,
    method: ctx.method,
    path: ctx.path,
    headers: Object.freeze({ ...ctx.headers }),
    body: ctx.body,
    parsedBody: Object.freeze({ ...ctx.parsedBody }),
    isStreaming: ctx.isStreaming,
    sessionId: ctx.sessionId,
  };
}

/** Convert internal ResponseInterceptContext to public ProxyResponse (no usage/latency available) */
export function toProxyResponseFromIntercept(ctx: ResponseInterceptContext): ProxyResponse {
  return {
    request: toProxyRequest(ctx.request),
    statusCode: ctx.statusCode,
    headers: Object.freeze({}),
    body: ctx.body,
    parsedBody: ctx.parsedBody ? Object.freeze({ ...ctx.parsedBody }) : null,
    isStreaming: ctx.isStreaming,
  };
}

/** Convert internal ResponseCompleteContext to public ProxyResponse (with usage/latency) */
export function toProxyResponseFromComplete(ctx: ResponseCompleteContext): ProxyResponse {
  return {
    request: toProxyRequest(ctx.request),
    statusCode: ctx.statusCode,
    headers: Object.freeze({}),
    body: ctx.body,
    parsedBody: ctx.parsedBody ? Object.freeze({ ...ctx.parsedBody }) : null,
    isStreaming: ctx.isStreaming,
    usage: ctx.usage ? { inputTokens: ctx.usage.inputTokens, outputTokens: ctx.usage.outputTokens } : undefined,
    latencyMs: ctx.latencyMs,
  };
}

/** Persist PluginResult.events to DB */
function persistEvents(
  pluginName: string,
  requestId: string | null,
  result: PluginResult | void,
  repo: PluginEventsRepository,
): void {
  if (!result?.events?.length) return;
  for (const event of result.events) {
    try {
      repo.insertEvent(pluginName, requestId, event);
    } catch (err) {
      log.warn('Failed to persist plugin event', { plugin: pluginName, error: (err as Error).message });
    }
  }
}

/** Convert public PluginResult to internal PluginRequestResult */
function toPluginRequestResult(result: PluginResult | void): PluginRequestResult {
  if (!result) return {};
  if (result.action === 'block') {
    return { blocked: { reason: `Blocked by plugin` } };
  }
  return {};
}

/** Convert public PluginResult to internal PluginResponseResult */
function toPluginResponseResult(result: PluginResult | void): PluginResponseResult {
  if (!result) return {};
  if (result.action === 'block') {
    return { blocked: { reason: `Blocked by plugin` } };
  }
  return {};
}

/** Adapt an external BastionPlugin to the internal Plugin interface */
export function adaptPlugin(
  external: BastionPlugin,
  priority: number,
  repo: PluginEventsRepository,
  packageName?: string,
): Plugin {
  const plugin: Plugin = {
    name: external.name,
    priority,
    version: external.version,
    apiVersion: external.apiVersion,
    source: 'external',
    packageName,
  };

  if (external.onRequest) {
    const originalOnRequest = external.onRequest.bind(external);
    plugin.onRequest = async (ctx: RequestContext) => {
      const proxyReq = toProxyRequest(ctx);
      const result = await originalOnRequest(proxyReq);
      persistEvents(external.name, ctx.id, result, repo);
      return toPluginRequestResult(result);
    };
  }

  if (external.onResponse) {
    const originalOnResponse = external.onResponse.bind(external);
    plugin.onResponse = async (ctx: ResponseInterceptContext) => {
      const proxyRes = toProxyResponseFromIntercept(ctx);
      const result = await originalOnResponse(proxyRes);
      persistEvents(external.name, ctx.request.id, result, repo);
      return toPluginResponseResult(result);
    };
  }

  if (external.onResponseComplete) {
    const originalOnResponseComplete = external.onResponseComplete.bind(external);
    plugin.onResponseComplete = async (ctx: ResponseCompleteContext) => {
      const proxyRes = toProxyResponseFromComplete(ctx);
      await originalOnResponseComplete(proxyRes);
    };
  }

  return plugin;
}
