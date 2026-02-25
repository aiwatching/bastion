export interface BastionConfig {
  server: {
    host: string;
    port: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  plugins: {
    metrics: {
      enabled: boolean;
    };
    dlp: {
      enabled: boolean;
      action: 'pass' | 'warn' | 'redact' | 'block';
      patterns: ('high-confidence' | 'validated' | 'context-aware' | 'prompt-injection')[];
      remotePatterns: {
        url: string;
        branch: string;
        syncOnStart: boolean;
        syncIntervalMinutes: number;
      };
      aiValidation: {
        enabled: boolean;
        provider: 'anthropic' | 'openai';
        model: string;
        apiKey: string;
        timeoutMs: number;
        cacheSize: number;
      };
      semantics: {
        sensitivePatterns: string[];
        nonSensitiveNames: string[];
      };
    };
    optimizer: {
      enabled: boolean;
      cache: boolean;
      cacheTtlSeconds: number;
      trimWhitespace: boolean;
      reorderForCache: boolean;
    };
    audit: {
      enabled: boolean;
      rawData: boolean;
      rawMaxBytes: number;
      summaryMaxBytes: number;
    };
    toolGuard: {
      enabled: boolean;
      action: 'audit' | 'block';
      recordAll: boolean;
      blockMinSeverity: 'critical' | 'high' | 'medium' | 'low';
      alertMinSeverity: 'critical' | 'high' | 'medium' | 'low';
      alertDesktop: boolean;
      alertWebhookUrl: string;
    };
  };
  retention: {
    requestsHours: number;
    dlpEventsHours: number;
    toolCallsHours: number;
    optimizerEventsHours: number;
    sessionsHours: number;
    auditLogHours: number;
  };
  timeouts: {
    upstream: number;
    plugin: number;
  };
}
