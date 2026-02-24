// proxy-bootstrap.mjs
// Forces all Node.js HTTP/HTTPS traffic through the configured HTTP proxy.
//
// Usage: NODE_OPTIONS="--import /opt/bastion/proxy-bootstrap.mjs"
//
// Two layers:
//   1. Replace globalThis.fetch with undici.fetch + ProxyAgent (CONNECT tunnel)
//   2. Patch https.globalAgent — covers https.request(), node-fetch, axios, got
//
// Set BASTION_PROXY_DEBUG=1 to see diagnostic output.

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy;

const DEBUG = !!process.env.BASTION_PROXY_DEBUG;
const log = (...args) => DEBUG && console.error('[proxy-bootstrap]', ...args);

if (proxyUrl) {
  log('proxy:', proxyUrl);

  const noProxyList = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  log('no_proxy:', noProxyList.join(', '));

  const shouldBypass = (hostname) => {
    const h = (hostname || '').toLowerCase();
    return noProxyList.some((np) => h === np || h.endsWith('.' + np));
  };

  const getHostname = (input) => {
    try {
      if (typeof input === 'string') return new URL(input).hostname;
      if (input instanceof URL) return input.hostname;
      if (input instanceof Request) return new URL(input.url).hostname;
    } catch {}
    return null;
  };

  const _builtinFetch = globalThis.fetch;

  // ── Layer 1: Replace fetch() with undici.fetch + ProxyAgent ─────────────
  // Why replacement is needed:
  //   Node.js built-in fetch() uses an INTERNAL undici copy.
  //   import('undici') from node_modules gives a DIFFERENT copy.
  //   setGlobalDispatcher() on node_modules undici does NOT affect built-in fetch.
  //   Fix: replace globalThis.fetch with undici.fetch which respects our dispatcher.
  try {
    const undici = await import('undici');
    log('undici imported, exports:', Object.keys(undici).filter(k =>
      ['EnvHttpProxyAgent', 'ProxyAgent', 'fetch', 'setGlobalDispatcher'].includes(k)
    ).join(', '));

    let dispatcher = null;

    if (typeof undici.EnvHttpProxyAgent === 'function') {
      dispatcher = new undici.EnvHttpProxyAgent();
      log('using EnvHttpProxyAgent (auto NO_PROXY)');
    } else if (typeof undici.ProxyAgent === 'function') {
      dispatcher = new undici.ProxyAgent(proxyUrl);
      log('using ProxyAgent (manual NO_PROXY)');
    } else {
      log('WARN: no ProxyAgent available in undici');
    }

    if (dispatcher && typeof undici.fetch === 'function') {
      undici.setGlobalDispatcher(dispatcher);
      const _uf = undici.fetch;

      // Wrap with NO_PROXY check (EnvHttpProxyAgent handles it, but be safe)
      globalThis.fetch = function (input, init) {
        const host = getHostname(input);
        if (host && shouldBypass(host)) {
          log('fetch bypass:', host);
          return _builtinFetch.call(globalThis, input, init);
        }
        log('fetch proxy:', host);
        return _uf.call(globalThis, input, init);
      };
      log('fetch patched OK');
    } else {
      log('WARN: could not patch fetch (dispatcher:', !!dispatcher, ', undici.fetch:', typeof undici.fetch, ')');
    }
  } catch (e) {
    log('WARN: undici layer failed:', e.message);
    // fetch remains unpatched — BASE_URL env vars are the fallback
  }

  // ── Layer 2: Patch https.globalAgent (CONNECT tunnel) ──────────────────
  // Covers: https.request(), https.get(), node-fetch, axios, got, etc.
  try {
    const http = await import('node:http');
    const https = await import('node:https');
    const tls = await import('node:tls');

    const proxy = new URL(proxyUrl);
    const proxyHost = proxy.hostname;
    const proxyPort = parseInt(proxy.port, 10) || 80;

    const _origCreateConn = https.Agent.prototype.createConnection;

    class TunnelAgent extends https.Agent {
      createConnection(options, oncreate) {
        const host = options.hostname || options.host || options.servername;
        const port = options.port || 443;

        if (!host || shouldBypass(host)) {
          return _origCreateConn.call(this, options, oncreate);
        }

        log('tunnel:', host + ':' + port);

        const req = http.request({
          hostname: proxyHost,
          port: proxyPort,
          method: 'CONNECT',
          path: `${host}:${port}`,
          headers: { Host: `${host}:${port}` },
        });

        req.on('connect', (res, socket) => {
          if (res.statusCode !== 200) {
            socket.destroy();
            oncreate?.(
              new Error(
                `Proxy CONNECT to ${host}:${port} failed: ${res.statusCode}`,
              ),
            );
            return;
          }
          oncreate?.(null, tls.connect({ socket, servername: host }));
        });

        req.on('error', (err) => oncreate?.(err));
        req.end();
      }
    }

    https.globalAgent = new TunnelAgent({ keepAlive: true });
    log('https.globalAgent patched OK');
  } catch (e) {
    log('WARN: https.globalAgent patch failed:', e.message);
  }
} else {
  log('no proxy URL found, skipping');
}
