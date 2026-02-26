export declare const PLUGIN_API_VERSION = 2;
export interface BastionPlugin {
    name: string;
    version: string;
    apiVersion: number;
    onInit?(context: PluginContext): Promise<void>;
    onDestroy?(): Promise<void>;
    onRequest?(req: ProxyRequest): Promise<PluginResult | void>;
    onResponse?(res: ProxyResponse): Promise<PluginResult | void>;
    onResponseComplete?(res: ProxyResponse): Promise<void>;
}
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
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    latencyMs?: number;
}
export interface PluginResult {
    action: 'pass' | 'warn' | 'redact' | 'block';
    modified?: boolean;
    events?: PluginEvent[];
}
export interface PluginEvent {
    type: 'dlp' | 'prompt-injection' | 'tool-guard' | 'custom';
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    rule: string;
    detail: string;
    matchedText?: string;
}
//# sourceMappingURL=types.d.ts.map