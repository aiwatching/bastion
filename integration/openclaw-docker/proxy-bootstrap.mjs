// proxy-bootstrap.mjs
// Forces all Node.js HTTP/HTTPS traffic through the configured HTTP proxy.
//
// Usage: NODE_OPTIONS="--import /opt/bastion/proxy-bootstrap.mjs"
//
// Two layers (neither requires undici):
//   1. Wrap globalThis.fetch → routes HTTPS through https.request (with tunnel agent)
//   2. Patch https.globalAgent → CONNECT tunnel for https.request/node-fetch/axios/got
//
// Uses createRequire to get writable CJS module refs (ESM namespaces are read-only).
// Set BASTION_PROXY_DEBUG=1 for diagnostic output.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');

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

  const proxy = new URL(proxyUrl);
  const proxyHost = proxy.hostname;
  const proxyPort = parseInt(proxy.port, 10) || 80;

  // ── Layer 2: Patch https.globalAgent (CONNECT tunnel) ──────────────────
  // Must be set up BEFORE Layer 1, since Layer 1's fetch wrapper uses https.request.
  try {
    const _origCC = https.Agent.prototype.createConnection;

    class TunnelAgent extends https.Agent {
      createConnection(options, oncreate) {
        const host = options.hostname || options.host || options.servername;
        const port = options.port || 443;

        if (!host || shouldBypass(host)) {
          return _origCC.call(this, options, oncreate);
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
              new Error(`CONNECT ${host}:${port} failed: ${res.statusCode}`),
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
    log('https.globalAgent patched');
  } catch (e) {
    log('WARN: https.globalAgent patch failed:', e.message);
  }

  // ── Layer 1: Wrap globalThis.fetch ─────────────────────────────────────
  // Routes HTTPS fetch() calls through https.request(), which uses our
  // patched globalAgent (TunnelAgent). No undici dependency needed.
  const _origFetch = globalThis.fetch;

  if (typeof _origFetch === 'function') {
    globalThis.fetch = async function (input, init) {
      let url;
      try {
        if (typeof input === 'string') url = new URL(input);
        else if (input instanceof URL) url = new URL(input.href);
        else if (input instanceof Request) url = new URL(input.url);
      } catch {}

      // Only intercept HTTPS requests to non-bypassed hosts
      if (!url || url.protocol !== 'https:' || shouldBypass(url.hostname)) {
        return _origFetch.call(globalThis, input, init);
      }

      log('fetch proxy:', url.hostname + url.pathname);

      // Collect headers
      const headerEntries = {};
      const h = new Headers(
        init?.headers ||
          (input instanceof Request ? input.headers : undefined),
      );
      for (const [k, v] of h) headerEntries[k] = v;

      // Collect method and body
      const method =
        init?.method || (input instanceof Request ? input.method : 'GET');
      let body = init?.body;
      if (body === undefined && input instanceof Request) body = input.body;

      return new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method,
            headers: headerEntries,
          },
          (res) => {
            // Convert Node.js stream → web ReadableStream for Response
            const stream = new ReadableStream({
              start(controller) {
                res.on('data', (chunk) =>
                  controller.enqueue(new Uint8Array(chunk)),
                );
                res.on('end', () => controller.close());
                res.on('error', (err) => controller.error(err));
              },
            });

            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value == null) continue;
              if (Array.isArray(value))
                value.forEach((v) => responseHeaders.append(key, v));
              else responseHeaders.set(key, value);
            }

            resolve(
              new Response(stream, {
                status: res.statusCode,
                statusText: res.statusMessage,
                headers: responseHeaders,
              }),
            );
          },
        );

        // AbortSignal support
        if (init?.signal) {
          if (init.signal.aborted) {
            req.destroy();
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
          init.signal.addEventListener('abort', () => {
            req.destroy();
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }

        req.on('error', reject);

        // Send request body
        if (body == null) {
          req.end();
        } else if (typeof body === 'string') {
          req.end(body);
        } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
          req.end(Buffer.from(body));
        } else if (body instanceof ReadableStream) {
          const reader = body.getReader();
          const pump = () =>
            reader.read().then(({ done, value }) => {
              if (done) {
                req.end();
                return;
              }
              req.write(value);
              return pump();
            });
          pump().catch((err) => {
            req.destroy(err);
            reject(err);
          });
        } else {
          // Fallback — try to write whatever it is
          req.end(body);
        }
      });
    };

    log('fetch wrapped');
  }
} else {
  log('no proxy URL found, skipping');
}
