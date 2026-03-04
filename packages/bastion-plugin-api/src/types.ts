export const PLUGIN_API_VERSION = 2;

// ── Plugin interface ──

export interface BastionPlugin {
  name: string;
  version: string;
  apiVersion: number; // must match PLUGIN_API_VERSION
  priority?: number; // declared execution order (lower = runs first); auto-assigned from 50 if omitted

  // Lifecycle (called by loader in Step 2.2)
  onInit?(context: PluginContext): Promise<void>;
  onDestroy?(): Promise<void>;

  // Request/Response hooks
  onRequest?(req: ProxyRequest): Promise<PluginResult | void>;
  onResponse?(res: ProxyResponse): Promise<PluginResult | void>;
  onResponseComplete?(res: ProxyResponse): Promise<void>;
}

// ── Plugin Manifest (plugin.json schema) ──

export interface PluginManifest {
  name: string;
  version: string;
  apiVersion: number;
  main: string;
  priority: number;
  config?: Record<string, unknown>;
  description?: string;
  author?: string;
}

// ── Plugin context ──

export interface PluginContext {
  config: Record<string, unknown>;
  logger: Logger;
  db: DatabaseAccess;
  getPluginState<T>(key: string): T | undefined;
  setPluginState<T>(key: string, value: T): void;
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface DatabaseAccess {
  insertEvent(event: PluginEvent): void;
}

// ── Request / Response (public surface, no internal flags) ──

export interface ProxyRequest {
  id: string;
  provider: string;
  model: string;
  method: string;
  path: string;
  headers: Readonly<Record<string, string>>;
  body: string;
  parsedBody: Readonly<Record<string, unknown>>;
  isStreaming: boolean;
  sessionId?: string;
}

export interface ProxyResponse {
  request: ProxyRequest;
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: string;
  parsedBody: Readonly<Record<string, unknown>> | null;
  isStreaming: boolean;
  // Available in onResponseComplete
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
}

// ── Plugin result ──

export interface PluginResult {
  action: 'pass' | 'warn' | 'redact' | 'block';
  modified?: boolean;
  events?: PluginEvent[];
}

// ── Plugin event ──

export interface PluginEvent {
  type: 'dlp' | 'prompt-injection' | 'tool-guard' | 'custom';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  rule: string;
  detail: string;
  matchedText?: string;
}

// ── ML Classifier abstraction ──

export interface ClassificationResult {
  label: string;           // e.g. 'INJECTION', 'BENIGN', 'JAILBREAK'
  score: number;           // 0-1
  labels: Array<{ label: string; score: number }>;
  latencyMs: number;
}

export interface ClassifierProvider {
  readonly name: string;
  readonly modelName: string;
  readonly ready: boolean;
  initialize(): Promise<void>;
  classify(text: string): Promise<ClassificationResult>;
  classifyBatch?(texts: string[]): Promise<ClassificationResult[]>;
  destroy(): Promise<void>;
}
