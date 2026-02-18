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
    };
    optimizer: {
      enabled: boolean;
      cache: boolean;
      trimWhitespace: boolean;
      reorderForCache: boolean;
    };
    audit: {
      enabled: boolean;
      retentionHours: number;
    };
  };
  timeouts: {
    upstream: number;
    plugin: number;
  };
}
