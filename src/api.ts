import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { bootstrap, type BootstrapResult } from './core/bootstrap.js';
import type { BastionConfig } from './config/schema.js';
import type { ConfigManager } from './config/manager.js';
import type { PluginManager } from './plugins/index.js';
import type { PluginEventBus } from './plugins/event-bus.js';
import { ensureCA, getCACertPath } from './proxy/certs.js';
import { closeDatabase } from './storage/database.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('api');

// ── Public types ──

export interface BastionServerOptions {
  configPath?: string;
  config?: Partial<BastionConfig>;
  port?: number;
  host?: string;
  silent?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  dbPath?: string;
  skipPidFile?: boolean;
  skipRetention?: boolean;
}

export interface DlpFindingEvent {
  requestId: string;
  patternName: string;
  patternCategory: string;
  action: string;
  matchCount: number;
  direction: string;
}

export interface ToolGuardAlertEvent {
  requestId: string;
  toolName: string;
  ruleId: string;
  ruleName: string;
  severity: string;
  category: string;
  action: string;
  matchedText: string;
}

export interface RequestCompleteEvent {
  requestId: string;
  statusCode: number;
  latencyMs: number;
  isStreaming: boolean;
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

export interface CertificateInfo {
  certPath: string;
  exists: boolean;
}

export interface BastionServer {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  readonly caCertPath: string;
  readonly dashboardUrl: string;
  readonly authToken: string | undefined;
  readonly config: BastionConfig;
  readonly plugins: PluginManager;
  readonly configManager: ConfigManager;

  on(event: 'dlp:finding', handler: (data: DlpFindingEvent) => void): BastionServer;
  on(event: 'toolguard:alert', handler: (data: ToolGuardAlertEvent) => void): BastionServer;
  on(event: 'request:complete', handler: (data: RequestCompleteEvent) => void): BastionServer;
  on(event: 'error', handler: (error: Error) => void): BastionServer;
  on(event: 'close', handler: () => void): BastionServer;

  off(event: string, handler: (...args: unknown[]) => void): BastionServer;
  removeAllListeners(event?: string): BastionServer;

  close(): Promise<void>;
}

// ── Implementation ──

class BastionServerImpl extends EventEmitter implements BastionServer {
  private result: BootstrapResult;
  private closed = false;

  constructor(result: BootstrapResult) {
    super();
    this.result = result;
    this.bridgeEvents(result.eventBus);
  }

  get port(): number {
    const addr = this.result.server.address() as AddressInfo | null;
    return addr?.port ?? this.result.config.server.port;
  }

  get host(): string {
    return this.result.config.server.host;
  }

  get url(): string {
    return `http://${this.host}:${this.port}`;
  }

  get caCertPath(): string {
    return getCACertPath();
  }

  get dashboardUrl(): string {
    return `${this.url}/dashboard`;
  }

  get authToken(): string | undefined {
    return this.result.authToken;
  }

  get config(): BastionConfig {
    return this.result.configManager.get();
  }

  get plugins(): PluginManager {
    return this.result.pluginManager;
  }

  get configManager(): ConfigManager {
    return this.result.configManager;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    log.info('Closing BastionServer');

    // Stop purge interval
    if (this.result.purgeInterval) {
      clearInterval(this.result.purgeInterval);
    }

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.result.server.close(() => resolve());
    });

    // Run destroy callbacks (external plugins)
    for (const cb of this.result.destroyCallbacks) {
      try {
        await cb();
      } catch (err) {
        log.warn('Destroy callback failed', { error: (err as Error).message });
      }
    }

    // Clean up event bus
    this.result.eventBus.removeAllListeners();

    // Close database
    closeDatabase();

    this.emit('close');
    this.removeAllListeners();

    log.info('BastionServer closed');
  }

  private bridgeEvents(eventBus: PluginEventBus): void {
    eventBus.on('dlp:finding', (data) => {
      this.emit('dlp:finding', data);
    });

    eventBus.on('toolguard:alert', (data) => {
      this.emit('toolguard:alert', data);
    });

    eventBus.on('request:complete', (data) => {
      this.emit('request:complete', data);
    });

    eventBus.on('request:blocked', (data) => {
      this.emit('request:blocked', data);
    });
  }
}

// ── Public API ──

export async function createServer(options?: BastionServerOptions): Promise<BastionServer> {
  const result = await bootstrap({
    configPath: options?.configPath,
    configOverrides: options?.config as Record<string, unknown>,
    silent: options?.silent ?? true,
    logLevel: options?.logLevel,
    port: options?.port,
    host: options?.host,
    dbPath: options?.dbPath,
    skipPidFile: options?.skipPidFile ?? true,
    skipRetention: options?.skipRetention,
  });

  const server = new BastionServerImpl(result);

  log.info('BastionServer created', {
    port: server.port,
    host: server.host,
    url: server.url,
  });

  return server;
}

export async function ensureCertificate(): Promise<CertificateInfo> {
  ensureCA();
  return {
    certPath: getCACertPath(),
    exists: true,
  };
}
