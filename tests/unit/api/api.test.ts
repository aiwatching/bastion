import { describe, it, expect, afterEach } from 'vitest';
import { createServer, ensureCertificate, type BastionServer } from '../../../src/api.js';

let server: BastionServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('createServer', () => {
  it('starts and returns BastionServer with valid port', async () => {
    server = await createServer({
      silent: true,
      port: 0,
      dbPath: ':memory:',
      skipPidFile: true,
      skipRetention: true,
    });

    expect(server.port).toBeGreaterThan(0);
    expect(server.host).toBeTruthy();
    expect(server.url).toContain(`http://`);
    expect(server.url).toContain(`:${server.port}`);
  });

  it('close() shuts down cleanly', async () => {
    server = await createServer({
      silent: true,
      port: 0,
      dbPath: ':memory:',
      skipPidFile: true,
      skipRetention: true,
    });

    const port = server.port;
    expect(port).toBeGreaterThan(0);

    await server.close();

    // Double-close is safe
    await server.close();
    server = null;
  });

  it('plugins property exposes PluginManager', async () => {
    server = await createServer({
      silent: true,
      port: 0,
      dbPath: ':memory:',
      skipPidFile: true,
      skipRetention: true,
    });

    const plugins = server.plugins.getPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    const names = plugins.map(p => p.name);
    expect(names).toContain('dlp-scanner');
    expect(names).toContain('tool-guard');
  });

  it('exposes dashboardUrl and caCertPath', async () => {
    server = await createServer({
      silent: true,
      port: 0,
      dbPath: ':memory:',
      skipPidFile: true,
      skipRetention: true,
    });

    expect(server.dashboardUrl).toContain('/dashboard');
    expect(server.caCertPath).toBeTruthy();
  });

  it('authToken is generated when not configured', async () => {
    server = await createServer({
      silent: true,
      port: 0,
      dbPath: ':memory:',
      skipPidFile: true,
      skipRetention: true,
    });

    // Default config has auth enabled but no token, so one should be generated
    expect(server.authToken).toBeTruthy();
    expect(typeof server.authToken).toBe('string');
  });
});

describe('ensureCertificate', () => {
  it('returns cert info', async () => {
    const info = await ensureCertificate();
    expect(info.certPath).toBeTruthy();
    expect(info.exists).toBe(true);
  });
});
