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
      patterns: ('high-confidence' | 'validated' | 'context-aware')[];
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
      retentionHours: number;
      rawData: boolean;
      rawMaxBytes: number;
      summaryMaxBytes: number;
    };
  };
  timeouts: {
    upstream: number;
    plugin: number;
  };
}
