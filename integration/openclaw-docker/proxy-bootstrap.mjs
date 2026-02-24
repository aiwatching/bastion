// proxy-bootstrap.mjs
// Forces all Node.js HTTP/HTTPS traffic through the configured HTTP proxy.
//
// Usage: NODE_OPTIONS="--import /opt/bastion/proxy-bootstrap.mjs"
//
// Patches two layers:
//   1. undici global dispatcher — covers native fetch() (Node.js 18+)
//   2. https.globalAgent — covers https.request(), node-fetch, axios, got, etc.
//
// Respects NO_PROXY for bypassing local addresses.

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

  /** Returns true if the hostname should bypass the proxy (matches NO_PROXY). */
  const shouldBypass = (hostname) => {
    const h = (hostname || '').toLowerCase();
    return noProxyList.some((np) => h === np || h.endsWith('.' + np));
  };

  // ── Layer 1: Patch native fetch() via undici ──────────────────────────────
  try {
    const { EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher } =
      await import('undici');

    if (typeof EnvHttpProxyAgent === 'function') {
      // Node 20.10+ — automatically reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY
      setGlobalDispatcher(new EnvHttpProxyAgent());
    } else if (typeof ProxyAgent === 'function') {
      // Older Node.js — no automatic NO_PROXY, but covers most traffic
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
    }
  } catch {
    // undici not resolvable (Node 18/20 without it installed) — Layer 2 still works
  }

  // ── Layer 2: Patch https.globalAgent with CONNECT tunnel ──────────────────
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

        // Bypass proxy for NO_PROXY hosts and unknown targets
        if (!host || shouldBypass(host)) {
          return _origCreateConn.call(this, options, oncreate);
        }

        // Open a CONNECT tunnel through the HTTP proxy
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
          // Upgrade the raw TCP socket to TLS
          // NODE_EXTRA_CA_CERTS ensures Bastion's MITM cert is trusted
          const tlsSocket = tls.connect({ socket, servername: host });
          oncreate?.(null, tlsSocket);
        });

        req.on('error', (err) => oncreate?.(err));
        req.end();
        // Return nothing — socket delivered asynchronously via oncreate
      }
    }

    https.globalAgent = new TunnelAgent({ keepAlive: true });
  } catch {
    // If this fails, HTTPS traffic won't be proxied automatically.
    // BASE_URL env vars may still work for some SDKs.
  }
}
