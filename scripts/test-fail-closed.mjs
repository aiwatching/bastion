#!/usr/bin/env node
/**
 * Manual test for fail-closed mode.
 * Starts a temporary bastion on port 18420 with a crashing plugin injected.
 *
 * Usage: node scripts/test-fail-closed.mjs
 */
import { createServer } from 'node:http';
import { PluginManager } from '../dist/plugins/index.js';

const PORT = 18420;

// --- Setup: two plugin managers (open vs closed) ---
const pmOpen = new PluginManager(1000, 'open');
const pmClosed = new PluginManager(1000, 'closed');

const crashPlugin = {
  name: 'crash-test',
  priority: 1,
  onRequest: async () => { throw new Error('simulated plugin crash'); },
};

pmOpen.register(crashPlugin);
pmClosed.register(crashPlugin);

// --- Tiny HTTP server ---
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const mode = url.searchParams.get('mode') || 'closed';
  const pm = mode === 'open' ? pmOpen : pmClosed;

  const ctx = {
    id: crypto.randomUUID(),
    provider: 'test', model: 'test', method: 'POST', path: '/',
    headers: {}, body: '{}', parsedBody: {}, isStreaming: false,
    startTime: Date.now(),
  };

  const result = await pm.runOnRequest(ctx);

  if (result.pluginError) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'Security pipeline error',
        detail: `Plugin ${result.pluginError.pluginName} failed`,
        type: 'gateway_pipeline_error',
      },
    }, null, 2));
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Request passed through (plugin error was skipped)' }, null, 2));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Test server running on http://localhost:${PORT}\n`);
  console.log('  Try these:\n');
  console.log(`    curl http://localhost:${PORT}?mode=closed   # → 502 (fail-closed blocks)`);
  console.log(`    curl http://localhost:${PORT}?mode=open     # → 200 (fail-open skips)\n`);
  console.log('  Ctrl+C to stop\n');
});
