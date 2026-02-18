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
}

export interface ShortCircuitResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface PluginRequestResult {
  shortCircuit?: ShortCircuitResponse;
  blocked?: { reason: string };
  modifiedBody?: string;
}

export interface Plugin {
  name: string;
  priority: number; // Lower = runs first
  onRequest?(context: RequestContext): Promise<PluginRequestResult | void>;
  onResponseComplete?(context: ResponseCompleteContext): Promise<void>;
}
