import type { Command } from 'commander';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';

const IS_WIN = platform() === 'win32';
import { loadConfig } from '../../config/index.js';
import { getCACertPath } from '../../proxy/certs.js';
import { getDaemonStatus } from '../daemon.js';
import { paths } from '../../config/paths.js';

const OPENCLAW_DIR = join(paths.bastionDir, 'openclaw');
const DEFAULT_PORT = 18789;
const DEFAULT_IMAGE = 'openclaw:local';

/** Brew shim for Docker — maps `brew install` to `apt-get install` so OpenClaw skills install correctly */
const BREW_SHIM_CONTENT = `#!/bin/sh
# brew shim for Debian/Ubuntu Docker containers
# Maps common brew commands to apt-get equivalents

# Package name mapping (brew name -> apt name)
map_pkg() {
  case "$1" in
    ripgrep) echo "ripgrep" ;;
    fd) echo "fd-find" ;;
    bat) echo "bat" ;;
    fzf) echo "fzf" ;;
    jq) echo "jq" ;;
    yq) echo "yq" ;;
    tree) echo "tree" ;;
    wget) echo "wget" ;;
    curl) echo "curl" ;;
    git) echo "git" ;;
    gh) echo "gh" ;;
    sqlite) echo "sqlite3" ;;
    python3|python) echo "python3" ;;
    *) echo "$1" ;;
  esac
}

case "$1" in
  install)
    shift
    PKGS=""
    for pkg in "$@"; do
      case "$pkg" in -*)  continue ;; esac
      PKGS="$PKGS $(map_pkg "$pkg")"
    done
    if [ -n "$PKGS" ]; then
      apt-get update -qq 2>/dev/null
      apt-get install -y -qq $PKGS
    fi
    ;;
  uninstall|remove)
    shift
    PKGS=""
    for pkg in "$@"; do
      case "$pkg" in -*) continue ;; esac
      PKGS="$PKGS $(map_pkg "$pkg")"
    done
    if [ -n "$PKGS" ]; then
      apt-get remove -y -qq $PKGS
    fi
    ;;
  list)
    dpkg -l 2>/dev/null | tail -n +6 | awk '{print $2}'
    ;;
  --version|-v)
    echo "brew-shim 1.0 (apt-get wrapper for Docker)"
    ;;
  *)
    echo "brew-shim: unsupported command '$1' (only install/uninstall/list supported)" >&2
    exit 1
    ;;
esac
`;

/** Proxy bootstrap script content — mounted into containers / local via NODE_OPTIONS="--import ..." */
const PROXY_BOOTSTRAP_CONTENT = `// proxy-bootstrap.mjs — forces all Node.js HTTP/HTTPS through the proxy
// Uses createRequire for writable CJS refs (ESM namespaces are read-only). No undici dependency.
// Set BASTION_PROXY_DEBUG=1 for diagnostic output.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const D = !!process.env.BASTION_PROXY_DEBUG, L = (...a) => D && console.error('[proxy-bootstrap]', ...a);
if (proxyUrl) {
  L('proxy:', proxyUrl);
  const noProxyList = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  L('no_proxy:', noProxyList.join(', '));
  const shouldBypass = (h) => { h = (h || '').toLowerCase(); return noProxyList.some(np => h === np || h.endsWith('.' + np)); };
  const proxy = new URL(proxyUrl), pH = proxy.hostname, pP = parseInt(proxy.port, 10) || 80;
  try {
    const _cc = https.Agent.prototype.createConnection;
    class T extends https.Agent {
      createConnection(o, cb) {
        const h = o.hostname || o.host || o.servername, p = o.port || 443;
        if (!h || shouldBypass(h)) return _cc.call(this, o, cb);
        L('tunnel:', h + ':' + p);
        const r = http.request({ hostname: pH, port: pP, method: 'CONNECT', path: h+':'+p, headers: { Host: h+':'+p } });
        r.on('connect', (res, sock) => { if (res.statusCode !== 200) { sock.destroy(); cb?.(new Error('CONNECT '+h+':'+p+' failed: '+res.statusCode)); return; } cb?.(null, tls.connect({ socket: sock, servername: h })); });
        r.on('error', e => cb?.(e)); r.end();
      }
    }
    https.globalAgent = new T({ keepAlive: true });
    L('https.globalAgent patched');
  } catch (e) { L('WARN: https.globalAgent patch failed:', e.message); }
  const _origFetch = globalThis.fetch;
  if (typeof _origFetch === 'function') {
    globalThis.fetch = async function(input, init) {
      let url;
      try { if (typeof input === 'string') url = new URL(input); else if (input instanceof URL) url = new URL(input.href); else if (input instanceof Request) url = new URL(input.url); } catch {}
      if (!url || url.protocol !== 'https:' || shouldBypass(url.hostname)) return _origFetch.call(globalThis, input, init);
      L('fetch proxy:', url.hostname + url.pathname);
      // Use Request to normalize headers and body (handles string, URLSearchParams, Blob, FormData, ArrayBuffer, ReadableStream, etc.)
      const normalized = new Request(input, init);
      const method = normalized.method;
      const hdrs = {}; for (const [k, v] of normalized.headers) hdrs[k] = v;
      const bodyBuf = normalized.body ? Buffer.from(await normalized.arrayBuffer()) : null;
      return new Promise((resolve, reject) => {
        const req = https.request({ hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method, headers: hdrs }, (res) => {
          const stream = new ReadableStream({ start(ctrl) { res.on('data', c => ctrl.enqueue(new Uint8Array(c))); res.on('end', () => ctrl.close()); res.on('error', e => ctrl.error(e)); } });
          const rh = new Headers(); for (const [k, v] of Object.entries(res.headers)) { if (v == null) continue; if (Array.isArray(v)) v.forEach(x => rh.append(k, x)); else rh.set(k, v); }
          resolve(new Response(stream, { status: res.statusCode, statusText: res.statusMessage, headers: rh }));
        });
        if (init?.signal) { if (init.signal.aborted) { req.destroy(); reject(new DOMException('The operation was aborted.', 'AbortError')); return; } init.signal.addEventListener('abort', () => { req.destroy(); reject(new DOMException('The operation was aborted.', 'AbortError')); }); }
        req.on('error', reject);
        if (bodyBuf) { req.end(bodyBuf); } else { req.end(); }
      });
    };
    L('fetch wrapped');
  }
} else { L('no proxy URL found, skipping'); }
`;

// ── shared helpers ───────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function checkBastion(): void {
  const status = getDaemonStatus();
  if (!status.running) {
    console.error('Bastion is not running. Start it first: bastion start');
    process.exit(1);
  }
}

function checkDocker(): void {
  try {
    execSync('docker info', { stdio: 'pipe' });
  } catch {
    console.error('Docker is not available. Please install and start Docker.');
    process.exit(1);
  }
}

function checkCACert(): string {
  const caPath = getCACertPath();
  if (!existsSync(caPath)) {
    console.error('Bastion CA cert not found. Run bastion start first to generate it.');
    process.exit(1);
  }
  return caPath;
}

function getBastionPort(): number {
  const config = loadConfig();
  return config.server.port;
}

function getBastionHost(): string {
  const config = loadConfig();
  return config.server.host;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── docker helpers ───────────────────────────────────────────────────────────

function instanceDir(name: string): string {
  return join(OPENCLAW_DIR, 'docker', name);
}

function envVal(name: string, key: string): string {
  const envFile = join(instanceDir(name), '.env');
  if (!existsSync(envFile)) return '';
  const content = readFileSync(envFile, 'utf-8');
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1] ?? '';
}

function writeEnvFile(dir: string, vars: Record<string, string>): void {
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  writeFileSync(join(dir, '.env'), content, 'utf-8');
}

function generateComposeFile(image: string): string {
  return `services:
  openclaw-gateway:
    image: \${OPENCLAW_IMAGE:-${image}}
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: \${OPENCLAW_GATEWAY_TOKEN}
      CLAUDE_AI_SESSION_KEY: \${CLAUDE_AI_SESSION_KEY}
      CLAUDE_WEB_SESSION_KEY: \${CLAUDE_WEB_SESSION_KEY}
      CLAUDE_WEB_COOKIE: \${CLAUDE_WEB_COOKIE}
    volumes:
      - \${OPENCLAW_CONFIG_DIR}:/home/node/.openclaw
      - \${OPENCLAW_WORKSPACE_DIR}:/home/node/.openclaw/workspace
    ports:
      - "\${OPENCLAW_GATEWAY_PORT:-18789}:18789"
      - "\${OPENCLAW_BRIDGE_PORT:-18790}:18790"
    init: true
    restart: unless-stopped
    command:
      [
        "node",
        "dist/index.js",
        "gateway",
        "--bind",
        "\${OPENCLAW_GATEWAY_BIND:-lan}",
        "--port",
        "18789",
      ]

  openclaw-cli:
    image: \${OPENCLAW_IMAGE:-${image}}
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: \${OPENCLAW_GATEWAY_TOKEN}
      BROWSER: echo
      CLAUDE_AI_SESSION_KEY: \${CLAUDE_AI_SESSION_KEY}
      CLAUDE_WEB_SESSION_KEY: \${CLAUDE_WEB_SESSION_KEY}
      CLAUDE_WEB_COOKIE: \${CLAUDE_WEB_COOKIE}
    volumes:
      - \${OPENCLAW_CONFIG_DIR}:/home/node/.openclaw
      - \${OPENCLAW_WORKSPACE_DIR}:/home/node/.openclaw/workspace
    stdin_open: true
    tty: true
    init: true
    entrypoint: ["node", "dist/index.js"]
`;
}

/** Bastion proxy overlay — merged via docker compose -f ... -f ... */
function generateBastionOverride(caPath: string): string {
  return `services:
  openclaw-gateway:
    user: root
    environment:
      HOME: /home/node
      HTTPS_PROXY: "http://openclaw-gw@host.docker.internal:\${BASTION_PORT:-8420}"
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/bastion-ca.crt"
      NO_PROXY: "localhost,127.0.0.1,host.docker.internal,auth.openai.com"
      NODE_OPTIONS: "--import /opt/bastion/proxy-bootstrap.mjs"
    volumes:
      - ${caPath}:/etc/ssl/certs/bastion-ca.crt:ro
      - ./proxy-bootstrap.mjs:/opt/bastion/proxy-bootstrap.mjs:ro
      - ./brew:/usr/local/bin/brew:ro

  openclaw-cli:
    user: root
    environment:
      HOME: /home/node
      HTTPS_PROXY: "http://openclaw-cli@host.docker.internal:\${BASTION_PORT:-8420}"
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/bastion-ca.crt"
      NO_PROXY: "localhost,127.0.0.1,host.docker.internal,auth.openai.com"
      NODE_OPTIONS: "--import /opt/bastion/proxy-bootstrap.mjs"
    volumes:
      - ${caPath}:/etc/ssl/certs/bastion-ca.crt:ro
      - ./proxy-bootstrap.mjs:/opt/bastion/proxy-bootstrap.mjs:ro
      - ./brew:/usr/local/bin/brew:ro
`;
}

/** Build the list of compose file args for an instance. */
function composeFileArgs(name: string): string[] {
  const dir = instanceDir(name);
  const args = ['-f', join(dir, 'docker-compose.yml')];
  const overrideFile = join(dir, 'docker-compose.bastion.yml');
  if (existsSync(overrideFile)) {
    args.push('-f', overrideFile);
  }
  return args;
}

/** Run docker compose scoped to an instance, inheriting stdio. Returns exit code. */
function dc(name: string, args: string[]): Promise<number> {
  const dir = instanceDir(name);
  const envFile = join(dir, '.env');
  return new Promise((resolve) => {
    const child = spawn('docker', [
      'compose',
      ...composeFileArgs(name),
      '--env-file', envFile,
      '-p', `openclaw-${name}`,
      ...args,
    ], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`docker compose error: ${err.message}`);
      resolve(1);
    });
  });
}

/** Run docker compose and capture stdout. */
function dcOutput(name: string, args: string[]): string {
  const dir = instanceDir(name);
  const envFile = join(dir, '.env');
  try {
    return execSync([
      'docker', 'compose',
      ...composeFileArgs(name),
      '--env-file', envFile,
      '-p', `openclaw-${name}`,
      ...args,
    ].map(a => `"${a}"`).join(' '), { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

/** Sync .env token with the token in openclaw.json (onboard may change it) */
function syncToken(name: string): void {
  const configDir = envVal(name, 'OPENCLAW_CONFIG_DIR');
  const configFile = join(configDir, 'openclaw.json');
  if (!existsSync(configFile)) return;

  try {
    const cfg = JSON.parse(readFileSync(configFile, 'utf-8'));
    const configToken = cfg?.gateway?.auth?.token;
    if (!configToken) return;

    const envToken = envVal(name, 'OPENCLAW_GATEWAY_TOKEN');
    if (configToken !== envToken) {
      const envFile = join(instanceDir(name), '.env');
      let content = readFileSync(envFile, 'utf-8');
      content = content.replace(
        /^OPENCLAW_GATEWAY_TOKEN=.*$/m,
        `OPENCLAW_GATEWAY_TOKEN=${configToken}`,
      );
      writeFileSync(envFile, content, 'utf-8');
      console.log('    (synced .env token with onboard config)');
    }
  } catch {
    // best-effort
  }
}

/** Ensure gateway config is correct for Docker networking */
function fixBind(name: string): void {
  const configDir = envVal(name, 'OPENCLAW_CONFIG_DIR');
  const configFile = join(configDir, 'openclaw.json');
  if (!existsSync(configFile)) return;

  try {
    const cfg = JSON.parse(readFileSync(configFile, 'utf-8'));
    let changed = false;

    if (!cfg.gateway) cfg.gateway = {};

    // bind=lan required for Docker container networking
    if (cfg.gateway.bind !== 'lan') {
      cfg.gateway.bind = 'lan';
      changed = true;
    }

    // non-loopback bind requires controlUi origin config
    if (!cfg.gateway.controlUi) cfg.gateway.controlUi = {};
    if (!cfg.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback) {
      cfg.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;
      changed = true;
    }

    if (changed) {
      writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf-8');
      console.log('    (fixed gateway config for Docker networking)');
    }
  } catch {
    // best-effort
  }
}

/** Approve all pending device pairing requests */
function approveDevices(name: string): void {
  const configDir = envVal(name, 'OPENCLAW_CONFIG_DIR');
  const pendingPath = join(configDir, 'devices', 'pending.json');
  const pairedPath = join(configDir, 'devices', 'paired.json');
  if (!existsSync(pendingPath)) return;

  try {
    const pending = JSON.parse(readFileSync(pendingPath, 'utf-8'));
    if (!pending || Object.keys(pending).length === 0) return;

    let paired: Record<string, unknown> = {};
    if (existsSync(pairedPath)) {
      paired = JSON.parse(readFileSync(pairedPath, 'utf-8'));
    }

    let count = 0;
    for (const [, dev] of Object.entries(pending) as [string, Record<string, unknown>][]) {
      const deviceId = dev.deviceId as string;
      paired[deviceId] = {
        deviceId: dev.deviceId,
        publicKey: dev.publicKey,
        platform: dev.platform,
        clientId: dev.clientId,
        clientMode: dev.clientMode ?? 'webchat',
        role: dev.role ?? 'operator',
        roles: dev.roles ?? ['operator'],
        scopes: dev.scopes ?? [],
        pairedAt: Date.now(),
      };
      count++;
    }

    mkdirSync(join(configDir, 'devices'), { recursive: true });
    writeFileSync(pairedPath, JSON.stringify(paired, null, 2), 'utf-8');
    writeFileSync(pendingPath, JSON.stringify({}, null, 2), 'utf-8');
    console.log(`    (auto-approved ${count} pending device(s))`);
  } catch {
    // best-effort
  }
}

// ── local helpers ────────────────────────────────────────────────────────────

const LOCAL_DIR = join(OPENCLAW_DIR, 'local');
const LOCAL_PID_FILE = join(LOCAL_DIR, 'openclaw.pid');

function localPidFile(name: string): string {
  return join(LOCAL_DIR, `${name}.pid`);
}

function localMetaFile(name: string): string {
  return join(LOCAL_DIR, `${name}.json`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findOpenclawBin(): string | null {
  try {
    const cmd = IS_WIN ? 'where openclaw' : 'which openclaw';
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
  } catch {
    // not in PATH
  }
  // Common install locations
  const candidates = IS_WIN
    ? [join(homedir(), '.openclaw', 'bin', 'openclaw.cmd')]
    : [
        join(homedir(), '.openclaw', 'bin', 'openclaw'),
        '/usr/local/bin/openclaw',
      ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// ── register ─────────────────────────────────────────────────────────────────

export function registerOpenclawCommand(program: Command): void {
  const openclaw = program
    .command('openclaw')
    .description('Manage OpenClaw instances routed through Bastion');

  // ════════════════════════════════════════════════════════════════════════════
  // bastion openclaw docker ...
  // ════════════════════════════════════════════════════════════════════════════
  const docker = openclaw
    .command('docker')
    .description('Manage OpenClaw via Docker Compose');

  // bastion openclaw docker attach <container>
  docker
    .command('attach')
    .description('Inject Bastion proxy into an already-running Docker container')
    .argument('<container>', 'Docker container name or ID')
    .option('--restart', 'Stop, commit, and re-run the container with proxy env vars baked in')
    .action(async (container: string, options: { restart?: boolean }) => {
      checkBastion();
      checkDocker();
      const caPath = checkCACert();
      const bastionPort = getBastionPort();

      // Verify container exists and is running
      try {
        const fmt = IS_WIN ? '"{{.State.Status}}"' : "'{{.State.Status}}'";
        const state = execSync(
          `docker inspect --format ${fmt} "${container}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        ).trim();
        if (state !== 'running') {
          console.error(`Container '${container}' is not running (state: ${state})`);
          process.exit(1);
        }
      } catch {
        console.error(`Container '${container}' not found`);
        process.exit(1);
      }

      // Copy CA cert into container
      console.log(`Copying CA cert into ${container}...`);
      execSync(
        `docker cp "${caPath}" "${container}:/etc/ssl/certs/bastion-ca.crt"`,
        { stdio: 'inherit' },
      );

      const envVars = {
        HTTPS_PROXY: `http://host.docker.internal:${bastionPort}`,
        NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/bastion-ca.crt',
        NO_PROXY: 'localhost,127.0.0.1,host.docker.internal',
      };

      if (options.restart) {
        console.log('Restarting container with proxy env vars...');
        const imgFmt = IS_WIN ? '"{{.Config.Image}}"' : "'{{.Config.Image}}'";
        const imageName = execSync(
          `docker inspect --format ${imgFmt} "${container}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        ).trim();

        const tmpImage = `bastion-attach-${container}-${Date.now()}`;
        execSync(`docker commit "${container}" "${tmpImage}"`, { stdio: 'inherit' });
        execSync(`docker stop "${container}"`, { stdio: 'inherit' });
        execSync(`docker rm "${container}"`, { stdio: 'inherit' });

        const envFlags = Object.entries(envVars)
          .map(([k, v]) => `-e ${k}="${v}"`)
          .join(' ');
        const volumeFlag = `-v "${caPath}:/etc/ssl/certs/bastion-ca.crt:ro"`;
        execSync(
          `docker run -d --name "${container}" ${envFlags} ${volumeFlag} "${tmpImage}"`,
          { stdio: 'inherit' },
        );
        console.log(`Container '${container}' restarted with Bastion proxy.`);
        console.log(`(Original image: ${imageName}, committed as: ${tmpImage})`);
      } else {
        console.log('');
        console.log('CA cert copied. Add these env vars to your docker-compose.yml or docker run:');
        console.log('');
        for (const [k, v] of Object.entries(envVars)) {
          console.log(`  ${k}=${v}`);
        }
        console.log('');
        console.log('And mount the CA cert volume:');
        console.log(`  -v ${caPath}:/etc/ssl/certs/bastion-ca.crt:ro`);
        console.log('');
      }
    });

  // bastion openclaw docker up <name>
  docker
    .command('up')
    .description('Create (if needed) and start an OpenClaw Docker instance')
    .argument('<name>', 'Instance name')
    .option('--port <port>', 'Gateway port', String(DEFAULT_PORT))
    .option('--image <image>', 'Docker image', DEFAULT_IMAGE)
    .option('--config-dir <path>', 'OpenClaw config directory (contains devices/, openclaw.json)')
    .option('--workspace <path>', 'OpenClaw workspace directory')
    .action(async (name: string, options: { port: string; image: string; configDir?: string; workspace?: string }) => {
      checkBastion();
      checkDocker();
      const caPath = checkCACert();
      const bastionPort = getBastionPort();
      const port = parseInt(options.port, 10);
      const bridgePort = port + 1;
      const dir = instanceDir(name);

      // If instance already exists, update overlay + bootstrap and start
      if (existsSync(dir)) {
        console.log(`Instance '${name}' exists, starting...`);

        // Always update proxy bootstrap + brew shim + Bastion override (idempotent)
        writeFileSync(join(dir, 'proxy-bootstrap.mjs'), PROXY_BOOTSTRAP_CONTENT, 'utf-8');
        writeFileSync(join(dir, 'brew'), BREW_SHIM_CONTENT, { mode: 0o755 });
        writeFileSync(join(dir, 'docker-compose.bastion.yml'), generateBastionOverride(caPath), 'utf-8');

        // Migrate old-style compose that had Bastion proxy baked in
        const existingCompose = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
        if (existingCompose.includes('NODE_EXTRA_CA_CERTS')) {
          const composeContent = generateComposeFile(options.image);
          writeFileSync(join(dir, 'docker-compose.yml'), composeContent, 'utf-8');
          console.log('    (migrated docker-compose.yml — Bastion proxy moved to docker-compose.bastion.yml)');
        }

        syncToken(name);
        fixBind(name);
        const code = await dc(name, ['up', '-d', '--force-recreate', 'openclaw-gateway']);
        if (code !== 0) process.exit(code);

        await sleep(3000);
        approveDevices(name);

        const finalPort = envVal(name, 'OPENCLAW_GATEWAY_PORT') || String(port);
        const finalToken = envVal(name, 'OPENCLAW_GATEWAY_TOKEN');
        console.log('');
        console.log(`Dashboard: http://127.0.0.1:${finalPort}/?token=${finalToken}`);
        return;
      }

      // Create new instance
      const configDir = options.configDir ?? join(homedir(), `.openclaw-${name}`);
      const workspaceDir = options.workspace ?? join(homedir(), `openclaw-${name}`, 'workspace');
      mkdirSync(dir, { recursive: true });
      mkdirSync(configDir, { recursive: true });
      mkdirSync(workspaceDir, { recursive: true });
      mkdirSync(join(configDir, 'devices'), { recursive: true });

      const token = generateToken();

      writeEnvFile(dir, {
        OPENCLAW_IMAGE: options.image,
        OPENCLAW_CONFIG_DIR: configDir,
        OPENCLAW_WORKSPACE_DIR: workspaceDir,
        OPENCLAW_GATEWAY_TOKEN: token,
        OPENCLAW_GATEWAY_PORT: String(port),
        OPENCLAW_BRIDGE_PORT: String(bridgePort),
        OPENCLAW_GATEWAY_BIND: 'lan',
        BASTION_PORT: String(bastionPort),
        CLAUDE_AI_SESSION_KEY: '',
        CLAUDE_WEB_SESSION_KEY: '',
        CLAUDE_WEB_COOKIE: '',
      });

      writeFileSync(join(dir, 'docker-compose.yml'), generateComposeFile(options.image), 'utf-8');
      writeFileSync(join(dir, 'docker-compose.bastion.yml'), generateBastionOverride(caPath), 'utf-8');
      writeFileSync(join(dir, 'proxy-bootstrap.mjs'), PROXY_BOOTSTRAP_CONTENT, 'utf-8');
      writeFileSync(join(dir, 'brew'), BREW_SHIM_CONTENT, { mode: 0o755 });

      console.log(`==> Instance '${name}' created (gateway: ${port}, bridge: ${bridgePort})`);

      console.log('==> Initializing gateway config...');
      let code = await dc(name, ['run', '--rm', 'openclaw-cli', 'config', 'set', 'gateway.mode', 'local']);
      if (code !== 0) {
        console.error('Failed to initialize gateway config');
        process.exit(code);
      }

      // Patch config before first start (controlUi origin, bind=lan)
      fixBind(name);

      console.log('==> Starting gateway...');
      code = await dc(name, ['up', '-d', 'openclaw-gateway']);
      if (code !== 0) process.exit(code);
      await sleep(3000);

      console.log('');
      console.log('==> Running interactive onboarding...');
      console.log(`    When prompted for gateway token, use: ${token}`);
      console.log('');
      code = await dc(name, ['exec', 'openclaw-gateway', 'node', 'dist/index.js', 'onboard', '--no-install-daemon']);
      if (code !== 0) {
        console.error('Onboarding failed');
        process.exit(code);
      }

      console.log('');
      console.log('==> Applying post-onboard fixes...');
      syncToken(name);
      fixBind(name);

      console.log('==> Restarting gateway...');
      await dc(name, ['restart', 'openclaw-gateway']);
      await sleep(3000);

      approveDevices(name);

      await dc(name, ['restart', 'openclaw-gateway']);
      await sleep(2000);

      const finalToken = envVal(name, 'OPENCLAW_GATEWAY_TOKEN');
      console.log('');
      console.log(`==> Instance '${name}' is ready!`);
      console.log('');
      console.log(`    Dashboard: http://127.0.0.1:${port}/?token=${finalToken}`);
      console.log('');
      console.log('    Open the URL above in your browser.');
      console.log('    If prompted to pair, refresh the page — devices are auto-approved.');
      console.log('');
    });

  // bastion openclaw docker run
  docker
    .command('run')
    .description('Start OpenClaw via an existing docker-compose.yml with Bastion proxy')
    .option('--compose <path>', 'Path to docker-compose.yml')
    .option('--env-file <path>', 'Path to .env file for docker compose')
    .option('-p, --project <name>', 'Docker compose project name', 'openclaw')
    .action((options: { compose?: string; envFile?: string; project: string }) => {
      checkBastion();
      checkDocker();
      checkCACert();
      const bastionPort = getBastionPort();

      let composeFile = options.compose;
      if (!composeFile) {
        const candidates = [
          join(process.cwd(), 'integration', 'openclaw-docker', 'docker-compose.yml'),
          join(process.cwd(), 'docker-compose.yml'),
        ];
        composeFile = candidates.find((f) => existsSync(f));
        if (!composeFile) {
          console.error('No docker-compose.yml found. Use --compose <path> to specify one.');
          process.exit(1);
        }
      }

      if (!existsSync(composeFile)) {
        console.error(`Compose file not found: ${composeFile}`);
        process.exit(1);
      }

      console.log(`Using compose file: ${composeFile}`);
      console.log(`Bastion proxy port: ${bastionPort}`);

      const args = [
        'compose',
        '-f', composeFile,
        ...(options.envFile ? ['--env-file', options.envFile] : []),
        '-p', options.project,
        'up', '-d',
      ];

      const env = { ...process.env, BASTION_PORT: String(bastionPort) };
      const child = spawn('docker', args, { stdio: 'inherit', env });

      child.on('close', (code) => {
        if (code === 0) {
          console.log('');
          console.log('OpenClaw started with Bastion proxy.');
        }
        process.exitCode = code ?? 0;
      });
      child.on('error', (err) => {
        console.error(`Failed to start: ${err.message}`);
        process.exitCode = 1;
      });
    });

  // bastion openclaw docker stop <name>
  docker
    .command('stop')
    .description('Stop a Docker OpenClaw instance')
    .argument('<name>', 'Instance name')
    .action(async (name: string) => {
      const dir = instanceDir(name);
      if (!existsSync(dir)) {
        console.error(`Instance '${name}' does not exist.`);
        process.exit(1);
      }
      console.log(`Stopping '${name}'...`);
      const code = await dc(name, ['down']);
      if (code !== 0) process.exit(code);
      console.log('Stopped.');
    });

  // bastion openclaw docker exec <name> [-- args...]
  docker
    .command('exec')
    .description('Run a command inside the OpenClaw gateway container')
    .argument('<name>', 'Instance name')
    .argument('[args...]', 'Command args (passed to openclaw CLI)')
    .passThroughOptions()
    .allowUnknownOption()
    .action(async (name: string, args: string[]) => {
      const dir = instanceDir(name);
      if (!existsSync(dir)) {
        console.error(`Instance '${name}' does not exist.`);
        process.exit(1);
      }
      const code = await dc(name, ['exec', 'openclaw-gateway', 'node', 'dist/index.js', ...args]);
      if (code !== 0) process.exit(code);
    });

  // bastion openclaw docker destroy <name>
  docker
    .command('destroy')
    .description('Stop and remove a Docker OpenClaw instance (data dirs preserved)')
    .argument('<name>', 'Instance name')
    .action(async (name: string) => {
      const dir = instanceDir(name);
      if (!existsSync(dir)) {
        console.error(`Instance '${name}' does not exist.`);
        process.exit(1);
      }

      // Read config/workspace paths before deleting
      const configDir = envVal(name, 'OPENCLAW_CONFIG_DIR');
      const workspaceDir = envVal(name, 'OPENCLAW_WORKSPACE_DIR');

      // docker compose down -v
      console.log(`Destroying instance '${name}'...`);
      await dc(name, ['down', '-v']);

      // Remove instance dir
      const { rmSync } = require('node:fs') as typeof import('node:fs');
      rmSync(dir, { recursive: true, force: true });

      console.log(`Instance '${name}' removed.`);
      console.log('');
      console.log('Data directories preserved (delete manually if needed):');
      if (configDir) console.log(`  ${configDir}`);
      if (workspaceDir) console.log(`  ${workspaceDir}`);
      console.log('');
      console.log(`To fully clean up: rm -rf ${configDir} ${workspaceDir}`);
    });

  // bastion openclaw docker status
  docker
    .command('status')
    .description('List all Docker OpenClaw instances')
    .action(() => {
      const dockerDir = join(OPENCLAW_DIR, 'docker');
      if (!existsSync(dockerDir)) {
        console.log('(no docker instances found)');
        return;
      }

      const entries = readdirSync(dockerDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      if (entries.length === 0) {
        console.log('(no docker instances found)');
        return;
      }

      const header = { name: 'INSTANCE', status: 'STATUS', port: 'GATEWAY', bridge: 'BRIDGE', dashboard: 'DASHBOARD' };
      const rows: typeof header[] = [header];

      for (const entry of entries) {
        const name = entry.name;
        const port = envVal(name, 'OPENCLAW_GATEWAY_PORT') || '-';
        const bridge = envVal(name, 'OPENCLAW_BRIDGE_PORT') || '-';
        const token = envVal(name, 'OPENCLAW_GATEWAY_TOKEN') || '';

        let state = 'stopped';
        try {
          state = dcOutput(name, ['ps', '--format', '{{.State}}', 'openclaw-gateway']) || 'stopped';
        } catch {
          // keep stopped
        }

        const dashboard = port !== '-' && token
          ? `http://127.0.0.1:${port}/?token=${token}`
          : '-';

        rows.push({ name, status: state, port, bridge, dashboard });
      }

      const colWidths = {
        name: Math.max(...rows.map((r) => r.name.length)) + 2,
        status: Math.max(...rows.map((r) => r.status.length)) + 2,
        port: Math.max(...rows.map((r) => r.port.length)) + 2,
        bridge: Math.max(...rows.map((r) => r.bridge.length)) + 2,
      };

      for (const row of rows) {
        console.log(
          row.name.padEnd(colWidths.name) +
          row.status.padEnd(colWidths.status) +
          row.port.padEnd(colWidths.port) +
          row.bridge.padEnd(colWidths.bridge) +
          row.dashboard,
        );
      }
    });

  // bastion openclaw docker logs <name>
  docker
    .command('logs')
    .description('Show logs for a Docker OpenClaw instance')
    .argument('<name>', 'Instance name')
    .option('-f, --follow', 'Follow log output')
    .action(async (name: string, options: { follow?: boolean }) => {
      const dir = instanceDir(name);
      if (!existsSync(dir)) {
        console.error(`Instance '${name}' does not exist.`);
        process.exit(1);
      }
      const args = ['logs'];
      if (options.follow) args.push('-f');
      args.push('openclaw-gateway');
      const code = await dc(name, args);
      if (code !== 0) process.exit(code);
    });

  // ════════════════════════════════════════════════════════════════════════════
  // bastion openclaw local ...
  // ════════════════════════════════════════════════════════════════════════════
  const local = openclaw
    .command('local')
    .description('Manage OpenClaw running as a local process');

  // bastion openclaw local start <name>
  local
    .command('start')
    .description('Start OpenClaw locally with Bastion proxy')
    .argument('<name>', 'Instance name')
    .option('--port <port>', 'Gateway port', String(DEFAULT_PORT))
    .option('--bin <path>', 'Path to openclaw binary')
    .option('--config-dir <path>', 'OpenClaw config directory')
    .option('--workspace <path>', 'OpenClaw workspace directory')
    .option('--foreground', 'Run in foreground (default: daemon)')
    .action((name: string, options: {
      port: string;
      bin?: string;
      configDir?: string;
      workspace?: string;
      foreground?: boolean;
    }) => {
      checkBastion();
      const caPath = checkCACert();
      const bastionPort = getBastionPort();
      const bastionHost = getBastionHost();
      const port = parseInt(options.port, 10);

      // Find openclaw binary
      const bin = options.bin ?? findOpenclawBin();
      if (!bin || !existsSync(bin)) {
        console.error(
          'OpenClaw binary not found. Install openclaw or use --bin <path>.\n' +
          'Or use "bastion openclaw docker" for Docker mode.',
        );
        process.exit(1);
      }

      // Check if already running
      const pidFile = localPidFile(name);
      if (existsSync(pidFile)) {
        const oldPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
        if (!isNaN(oldPid) && isProcessRunning(oldPid)) {
          console.error(`Instance '${name}' is already running (PID ${oldPid}). Stop it first.`);
          process.exit(1);
        }
        unlinkSync(pidFile);
      }

      const configDir = options.configDir ?? join(homedir(), `.openclaw-${name}`);
      const workspaceDir = options.workspace ?? join(homedir(), `openclaw-${name}`, 'workspace');
      mkdirSync(LOCAL_DIR, { recursive: true });
      mkdirSync(configDir, { recursive: true });
      mkdirSync(workspaceDir, { recursive: true });

      // Ensure proxy bootstrap script exists
      const bootstrapPath = join(paths.bastionDir, 'proxy-bootstrap.mjs');
      writeFileSync(bootstrapPath, PROXY_BOOTSTRAP_CONTENT, 'utf-8');

      // Build env with Bastion proxy
      const env: Record<string, string | undefined> = {
        ...process.env,
        HTTPS_PROXY: `http://openclaw-local-${name}@${bastionHost}:${bastionPort}`,
        NODE_EXTRA_CA_CERTS: caPath,
        NO_PROXY: `${bastionHost},localhost,127.0.0.1`,
        NODE_OPTIONS: `--import ${bootstrapPath}`,
        HOME: homedir(),
      };

      const args = ['gateway', '--port', String(port), '--bind', 'localhost'];

      // Save metadata
      writeFileSync(localMetaFile(name), JSON.stringify({
        port,
        configDir,
        workspaceDir,
        bin,
        startedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');

      if (options.foreground) {
        console.log(`Starting OpenClaw '${name}' on port ${port} (foreground)...`);
        console.log(`  Binary:    ${bin}`);
        console.log(`  Config:    ${configDir}`);
        console.log(`  Workspace: ${workspaceDir}`);
        console.log(`  Proxy:     ${bastionHost}:${bastionPort}`);
        console.log('');

        const child = spawn(bin, args, {
          stdio: 'inherit',
          env,
          cwd: workspaceDir,
          ...(IS_WIN ? { shell: true } : {}),
        });

        // Write PID
        if (child.pid) {
          writeFileSync(pidFile, String(child.pid), 'utf-8');
        }

        child.on('close', (code) => {
          if (existsSync(pidFile)) unlinkSync(pidFile);
          process.exitCode = code ?? 0;
        });
        child.on('error', (err) => {
          console.error(`Failed to start: ${err.message}`);
          if (existsSync(pidFile)) unlinkSync(pidFile);
          process.exitCode = 1;
        });
      } else {
        console.log(`Starting OpenClaw '${name}' on port ${port} (daemon)...`);

        const logFile = join(LOCAL_DIR, `${name}.log`);
        const { openSync } = require('node:fs') as typeof import('node:fs');
        const logFd = openSync(logFile, 'a');

        const child = spawn(bin, args, {
          detached: true,
          stdio: ['ignore', logFd, logFd],
          env,
          cwd: workspaceDir,
          ...(IS_WIN ? { shell: true, windowsHide: true } : {}),
        });

        child.unref();

        if (child.pid) {
          writeFileSync(pidFile, String(child.pid), 'utf-8');
          console.log(`  PID:       ${child.pid}`);
        }

        console.log(`  Binary:    ${bin}`);
        console.log(`  Port:      ${port}`);
        console.log(`  Config:    ${configDir}`);
        console.log(`  Workspace: ${workspaceDir}`);
        console.log(`  Proxy:     ${bastionHost}:${bastionPort}`);
        console.log(`  Log:       ${logFile}`);
        console.log('');
        console.log(`Dashboard: http://127.0.0.1:${port}/`);
      }
    });

  // bastion openclaw local stop <name>
  local
    .command('stop')
    .description('Stop a locally running OpenClaw instance')
    .argument('<name>', 'Instance name')
    .action((name: string) => {
      const pidFile = localPidFile(name);
      if (!existsSync(pidFile)) {
        console.error(`Instance '${name}' is not running (no PID file).`);
        process.exit(1);
      }

      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      if (isNaN(pid)) {
        console.error('Invalid PID file.');
        unlinkSync(pidFile);
        process.exit(1);
      }

      if (!isProcessRunning(pid)) {
        console.log(`Instance '${name}' is not running (stale PID ${pid}).`);
        unlinkSync(pidFile);
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Stopped '${name}' (PID ${pid}).`);
      } catch (err) {
        console.error(`Failed to stop PID ${pid}: ${(err as Error).message}`);
      }
      unlinkSync(pidFile);
    });

  // bastion openclaw local status
  local
    .command('status')
    .description('List all local OpenClaw instances')
    .action(() => {
      if (!existsSync(LOCAL_DIR)) {
        console.log('(no local instances found)');
        return;
      }

      const metaFiles = readdirSync(LOCAL_DIR).filter((f) => f.endsWith('.json'));
      if (metaFiles.length === 0) {
        console.log('(no local instances found)');
        return;
      }

      const header = { name: 'INSTANCE', status: 'STATUS', port: 'PORT', pid: 'PID', dashboard: 'DASHBOARD' };
      const rows: typeof header[] = [header];

      for (const file of metaFiles) {
        const name = file.replace(/\.json$/, '');
        const pidFile = localPidFile(name);

        let port = '-';
        let pidStr = '-';
        let state = 'stopped';

        try {
          const meta = JSON.parse(readFileSync(join(LOCAL_DIR, file), 'utf-8'));
          port = String(meta.port ?? '-');
        } catch {
          // ignore
        }

        if (existsSync(pidFile)) {
          const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
          if (!isNaN(pid) && isProcessRunning(pid)) {
            state = 'running';
            pidStr = String(pid);
          } else {
            // Stale PID
            if (existsSync(pidFile)) unlinkSync(pidFile);
          }
        }

        const dashboard = port !== '-'
          ? `http://127.0.0.1:${port}/`
          : '-';

        rows.push({ name, status: state, port, pid: pidStr, dashboard });
      }

      const colWidths = {
        name: Math.max(...rows.map((r) => r.name.length)) + 2,
        status: Math.max(...rows.map((r) => r.status.length)) + 2,
        port: Math.max(...rows.map((r) => r.port.length)) + 2,
        pid: Math.max(...rows.map((r) => r.pid.length)) + 2,
      };

      for (const row of rows) {
        console.log(
          row.name.padEnd(colWidths.name) +
          row.status.padEnd(colWidths.status) +
          row.port.padEnd(colWidths.port) +
          row.pid.padEnd(colWidths.pid) +
          row.dashboard,
        );
      }
    });

  // bastion openclaw local logs <name>
  local
    .command('logs')
    .description('Show logs for a local OpenClaw instance')
    .argument('<name>', 'Instance name')
    .option('-f, --follow', 'Follow log output')
    .action((name: string, options: { follow?: boolean }) => {
      const logFile = join(LOCAL_DIR, `${name}.log`);
      if (!existsSync(logFile)) {
        console.error(`No log file found for '${name}'.`);
        process.exit(1);
      }

      let child: ReturnType<typeof spawn>;
      if (IS_WIN) {
        // PowerShell Get-Content as replacement for tail
        const psArgs = options.follow
          ? ['-Command', `Get-Content -Path "${logFile}" -Tail 100 -Wait`]
          : ['-Command', `Get-Content -Path "${logFile}" -Tail 100`];
        child = spawn('powershell', psArgs, { stdio: 'inherit' });
      } else {
        const tailArgs = options.follow
          ? ['-f', logFile]
          : ['-100', logFile];
        child = spawn('tail', tailArgs, { stdio: 'inherit' });
      }
      child.on('close', (code) => {
        process.exitCode = code ?? 0;
      });
    });

  // ════════════════════════════════════════════════════════════════════════════
  // bastion openclaw build ...
  // ════════════════════════════════════════════════════════════════════════════
  openclaw
    .command('build')
    .description('Build OpenClaw Docker image from source')
    .option('--tag <tag>', 'Git branch/tag to build', 'main')
    .option('--brew', 'Install Homebrew (~500MB) for brew-based skills')
    .option('--browser', 'Install Chromium + Xvfb (~300MB) for browser automation')
    .option('--image <name>', 'Docker image name', DEFAULT_IMAGE)
    .option('--src <path>', 'Path to existing OpenClaw source (skip clone)')
    .action(async (options: {
      tag: string;
      brew?: boolean;
      browser?: boolean;
      image: string;
      src?: string;
    }) => {
      checkDocker();

      const srcDir = options.src ? resolve(options.src) : join(OPENCLAW_DIR, 'src');

      // Clone or update source
      if (options.src) {
        if (!existsSync(srcDir)) {
          console.error(`Source directory not found: ${srcDir}`);
          process.exit(1);
        }
        console.log(`==> Using existing source: ${srcDir}`);
      } else {
        console.log(`==> Preparing source (branch/tag: ${options.tag})...`);
        if (existsSync(srcDir)) {
          console.log('    Source directory exists, fetching latest...');
          execSync(`git -C "${srcDir}" fetch --all --tags`, { stdio: 'inherit' });
          execSync(`git -C "${srcDir}" checkout "${options.tag}"`, { stdio: 'inherit' });
          try { execSync(`git -C "${srcDir}" pull --ff-only`, { stdio: 'pipe' }); } catch { /* ignore */ }
        } else {
          console.log('    Cloning openclaw repository...');
          mkdirSync(join(OPENCLAW_DIR), { recursive: true });
          execSync(`git clone --branch "${options.tag}" https://github.com/openclaw/openclaw.git "${srcDir}"`, { stdio: 'inherit' });
        }
      }

      // Apply Bastion fixes — check if Dockerfile already has OPENCLAW_INSTALL_BREW support
      const dockerfilePath = join(srcDir, 'Dockerfile');
      if (existsSync(dockerfilePath)) {
        const dockerfileContent = readFileSync(dockerfilePath, 'utf-8');
        if (!dockerfileContent.includes('OPENCLAW_INSTALL_BREW')) {
          console.log('==> Patching Dockerfile with Homebrew build-arg support...');
          // Insert optional Linuxbrew installation before "USER node" + "COPY --chown=node:node . ."
          const brewBlock = `
# Optional: Install Linuxbrew for skill dependency management.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BREW=1 ...
# Adds ~500MB but enables brew-based skill installation (uv, go, signal-cli, etc.)
ARG OPENCLAW_INSTALL_BREW=""
RUN if [ -n "$OPENCLAW_INSTALL_BREW" ]; then \\
      apt-get update && \\
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential curl file git procps && \\
      if ! id -u linuxbrew >/dev/null 2>&1; then useradd -m -s /bin/bash linuxbrew; fi && \\
      mkdir -p /home/linuxbrew/.linuxbrew && \\
      chown -R linuxbrew:linuxbrew /home/linuxbrew && \\
      su - linuxbrew -c "NONINTERACTIVE=1 CI=1 /bin/bash -c '$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)'" && \\
      if [ ! -e /home/linuxbrew/.linuxbrew/Library ]; then ln -s /home/linuxbrew/.linuxbrew/Homebrew/Library /home/linuxbrew/.linuxbrew/Library; fi && \\
      if [ ! -x /home/linuxbrew/.linuxbrew/bin/brew ]; then echo "brew install failed"; exit 1; fi && \\
      chown -R node:node /home/linuxbrew/.linuxbrew && \\
      apt-get clean && \\
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \\
    fi
ENV HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew
ENV HOMEBREW_CELLAR=/home/linuxbrew/.linuxbrew/Cellar
ENV HOMEBREW_REPOSITORY=/home/linuxbrew/.linuxbrew/Homebrew
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:\${PATH}"
`;
          // Insert before the final "USER node\nCOPY --chown=node:node . ."
          const insertPoint = dockerfileContent.indexOf('\nUSER node\nCOPY --chown=node:node . .');
          if (insertPoint !== -1) {
            const patched = dockerfileContent.slice(0, insertPoint) + '\n' + brewBlock + dockerfileContent.slice(insertPoint);
            writeFileSync(dockerfilePath, patched, 'utf-8');
            console.log('    Patched Dockerfile');
          } else {
            console.log('    WARNING: Could not find insertion point in Dockerfile, skipping patch.');
          }
        }
      }

      // Build Docker image
      console.log(`==> Building Docker image '${options.image}'...`);
      const buildArgs: string[] = ['build'];
      const extras: string[] = [];

      if (options.brew) {
        buildArgs.push('--build-arg', 'OPENCLAW_INSTALL_BREW=1');
        extras.push('Homebrew (~500MB)');
      }
      if (options.browser) {
        buildArgs.push('--build-arg', 'OPENCLAW_INSTALL_BROWSER=1');
        extras.push('Chromium + Xvfb (~300MB)');
      }

      if (extras.length > 0) {
        console.log(`    Optional components: ${extras.join(', ')}`);
      }

      // Show hints for unused optional components
      const hints: string[] = [];
      if (!options.brew) {
        hints.push('--brew    : Homebrew for brew-based skills (1password-cli, signal-cli, etc.)');
      }
      if (!options.browser) {
        hints.push('--browser : Chromium for browser automation');
      }
      if (hints.length > 0) {
        console.log('');
        console.log('    TIP: Optional build flags available:');
        for (const hint of hints) {
          console.log(`      ${hint}`);
        }
        console.log(`    Example: bastion openclaw build --brew --browser`);
        console.log('');
      }

      buildArgs.push('-t', options.image, '-f', join(srcDir, 'Dockerfile'), srcDir);
      const code = await new Promise<number>((resolve) => {
        const child = spawn('docker', buildArgs, { stdio: 'inherit' });
        child.on('close', (c) => resolve(c ?? 1));
        child.on('error', (err) => {
          console.error(`docker build error: ${err.message}`);
          resolve(1);
        });
      });

      if (code !== 0) {
        console.error('Docker build failed.');
        process.exit(code);
      }

      console.log(`==> Build complete: ${options.image}`);
      if (options.brew) {
        console.log('    Homebrew installed — brew-shim will NOT be mounted for instances using this image.');
      }
    });
}
