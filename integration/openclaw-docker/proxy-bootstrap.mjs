// proxy-bootstrap.mjs
// Forces all Node.js HTTP/HTTPS traffic through the configured HTTP proxy.
//
// Usage: NODE_OPTIONS="--import /opt/bastion/proxy-bootstrap.mjs"
//
// Three layers:
//   1. Replace globalThis.fetch with undici.fetch + ProxyAgent
//   1b. Wrap globalThis.fetch with URL rewriting (fallback if undici unavailable)
//   2. Patch https.globalAgent — covers https.request(), node-fetch, axios, got
//
// Why replacing fetch is needed:
//   Node.js built-in fetch() uses an INTERNAL undici copy.
//   import('undici') resolves to node_modules — a DIFFERENT copy.
//   setGlobalDispatcher() on node_modules undici does NOT affect the built-in fetch.
//   The fix: replace globalThis.fetch with undici.fetch from node_modules,
//   which DOES respect our dispatcher.

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy;

if (proxyUrl) {
  const noProxyList = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  /** Returns true if the hostname should bypass the proxy. */
  const shouldBypass = (hostname) => {
    const h = (hostname || '').toLowerCase();
    return noProxyList.some((np) => h === np || h.endsWith('.' + np));
  };

  /** Extract hostname from a fetch input. */
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
  let fetchPatched = false;
  try {
    const undici = await import('undici');

    if (typeof undici.EnvHttpProxyAgent === 'function') {
      // Node 20.10+ — reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY automatically
      undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
      globalThis.fetch = undici.fetch;
      fetchPatched = true;
    } else if (
      typeof undici.ProxyAgent === 'function' &&
      typeof undici.fetch === 'function'
    ) {
      // Older undici — manual NO_PROXY check
      undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl));
      const _uf = undici.fetch;
      globalThis.fetch = function (input, init) {
        const host = getHostname(input);
        if (host && shouldBypass(host)) {
          return _builtinFetch.call(globalThis, input, init);
        }
        return _uf.call(globalThis, input, init);
      };
      fetchPatched = true;
    }
  } catch {
    // undici not resolvable — fall through to Layer 1b
  }

  // ── Layer 1b: Wrap fetch() with URL rewriting (fallback) ────────────────
  // Rewrites https:// URLs to http://proxy:port/ so Bastion routes by path.
  // Only used when undici is not available in node_modules.
  if (!fetchPatched && typeof _builtinFetch === 'function') {
    const proxy = new URL(proxyUrl);
    const proxyBase = `http://${proxy.hostname}:${proxy.port || 80}`;

    globalThis.fetch = function (input, init) {
      try {
        let url;
        if (typeof input === 'string') url = new URL(input);
        else if (input instanceof URL) url = new URL(input.href);
        else if (input instanceof Request) url = new URL(input.url);

        if (url && url.protocol === 'https:' && !shouldBypass(url.hostname)) {
          const rewritten = `${proxyBase}${url.pathname}${url.search}`;
          const h = new Headers(
            init?.headers ||
              (input instanceof Request ? input.headers : undefined),
          );
          h.set('X-Forwarded-Host', url.host);
          h.set('X-Forwarded-Proto', 'https');
          const mergedInit = { ...init, headers: h };
          if (input instanceof Request) {
            if (!mergedInit.method) mergedInit.method = input.method;
            if (mergedInit.body === undefined) mergedInit.body = input.body;
          }
          return _builtinFetch.call(globalThis, rewritten, mergedInit);
        }
      } catch {
        // Fall through to original on any error
      }
      return _builtinFetch.call(globalThis, input, init);
    };
  }

  // ── Layer 2: Patch https.globalAgent (CONNECT tunnel) ──────────────────
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
          // NODE_EXTRA_CA_CERTS ensures Bastion's MITM cert is trusted
          oncreate?.(null, tls.connect({ socket, servername: host }));
        });

        req.on('error', (err) => oncreate?.(err));
        req.end();
      }
    }

    https.globalAgent = new TunnelAgent({ keepAlive: true });
  } catch {
    // If this fails, only fetch-based traffic will be proxied.
  }
}
