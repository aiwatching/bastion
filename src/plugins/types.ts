export interface RequestContext {
  id: string;
  provider: string;
  model: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  parsedBody: Record<string, unknown>;
  isStreaming: boolean;
  startTime: number;
  sessionId?: string;
  sessionSource?: string; // 'wrap' | 'auto' | 'direct'
  apiKeyHash?: string;
  /** Set by DLP scanner during onRequest/onResponse for downstream plugins */
  dlpHit?: boolean;
  dlpAction?: string;
  dlpFindings?: number;
  /** Set by tool-guard plugin during onResponseComplete */
  toolGuardHit?: boolean;
  toolGuardFindings?: number;
  /** Internal: set by tool-guard onResponse to skip duplicate recording in onResponseComplete */
  _toolGuardRecorded?: boolean;
  /** Internal: set by tool-guard onRequest to enable streaming interception in forwarder.
   *  Value is the blockMinSeverity threshold. */
  _toolGuardStreamBlock?: string;
  /** Internal: DB-loaded rules for streaming guard (set by tool-guard onRequest) */
  _toolGuardRules?: import('../tool-guard/rules.js').ToolGuardRule[];
}

export interface ResponseCompleteContext {
  request: RequestContext;
  statusCode: number;
  body: string;
  parsedBody: Record<string, unknown> | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
  latencyMs: number;
  isStreaming: boolean;
  /** Pre-parsed SSE events from streaming responses (avoids re-parsing body) */
  sseEvents?: Record<string, unknown>[];
}

export interface ShortCircuitResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface PluginRequestResult {
  shortCircuit?: ShortCircuitResponse;
  blocked?: { reason: string };
  pluginError?: { pluginName: string; reason: string };
  modifiedBody?: string;
}

export interface ResponseInterceptContext {
  request: RequestContext;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  parsedBody: Record<string, unknown> | null;
  isStreaming: boolean;
}

export interface PluginResponseResult {
  blocked?: { reason: string };
  pluginError?: { pluginName: string; reason: string };
  modifiedBody?: string;
}

export interface Plugin {
  name: string;
  priority: number; // Lower = runs first
  version?: string;
  apiVersion?: number;
  source?: 'builtin' | 'external';
  packageName?: string;
  onRequest?(context: RequestContext): Promise<PluginRequestResult | void>;
  onResponse?(context: ResponseInterceptContext): Promise<PluginResponseResult | void>;
  onResponseComplete?(context: ResponseCompleteContext): Promise<void>;
}
