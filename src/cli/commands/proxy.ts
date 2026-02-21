import type { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig } from '../../config/index.js';
import { getCACertPath, ensureCA } from '../../proxy/certs.js';
import { getDaemonStatus } from '../daemon.js';

const BASTION_MARKER_START = '# >>> bastion proxy >>>';
const BASTION_MARKER_END = '# <<< bastion proxy <<<';
const IS_MAC = platform() === 'darwin';
const IS_LINUX = platform() === 'linux';
const IS_WIN = platform() === 'win32';

type ShellType = 'fish' | 'powershell' | 'posix';

/** Detect current shell type for syntax generation */
function shellType(): ShellType {
  // Windows without a Unix-like shell (Git Bash sets SHELL)
  if (IS_WIN && !process.env.SHELL) return 'powershell';
  if ((process.env.SHELL ?? '').endsWith('fish')) return 'fish';
  return 'posix';
}

/** Generate a "set env var" command for the detected shell */
function emitSet(key: string, value: string, shell?: ShellType): string {
  const s = shell ?? shellType();
  if (s === 'powershell') return `$env:${key}="${value}";`;
  if (s === 'fish') return `set -gx ${key} "${value}";`;
  return `export ${key}="${value}";`;
}

/** Generate an "unset env var" command for the detected shell */
function emitUnset(key: string, shell?: ShellType): string {
  const s = shell ?? shellType();
  if (s === 'powershell') return `Remove-Item Env:\\${key} -ErrorAction SilentlyContinue;`;
  if (s === 'fish') return `set -e ${key};`;
  return `unset ${key};`;
}

function getShellProfile(): string {
  if (IS_WIN && !process.env.SHELL) {
    // PowerShell 7+ profile
    const psProfile = join(homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    if (existsSync(psProfile)) return psProfile;
    // Fallback to Windows PowerShell 5.x
    return join(homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
  }
  const shell = process.env.SHELL ?? '/bin/zsh';
  if (shell.endsWith('zsh')) return join(homedir(), '.zshrc');
  if (shell.endsWith('bash')) {
    const profile = join(homedir(), '.bash_profile');
    if (existsSync(profile)) return profile;
    return join(homedir(), '.bashrc');
  }
  if (shell.endsWith('fish')) return join(homedir(), '.config', 'fish', 'config.fish');
  return join(homedir(), '.zshrc');
}

// All env vars set by bastion proxy on
const BASE_URL_VARS = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GOOGLE_AI_BASE_URL'];
const ALL_PROXY_VARS = [
  'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
  ...BASE_URL_VARS,
];

function buildProxyBlock(baseUrl: string, caCertPath: string, noProxy: string): string {
  const shell = shellType();
  const lines = [BASTION_MARKER_START];

  const vars: [string, string][] = [
    ['HTTPS_PROXY', baseUrl],
    ['NO_PROXY', noProxy],
    ['NODE_EXTRA_CA_CERTS', caCertPath],
    ...BASE_URL_VARS.map((v): [string, string] => [v, baseUrl]),
  ];

  for (const [key, value] of vars) {
    lines.push(emitSet(key, value, shell));
  }

  lines.push(BASTION_MARKER_END);
  return lines.join('\n');
}

function removeProxyBlock(profilePath: string): boolean {
  if (!existsSync(profilePath)) return false;
  const content = readFileSync(profilePath, 'utf-8');
  const startIdx = content.indexOf(BASTION_MARKER_START);
  const endIdx = content.indexOf(BASTION_MARKER_END);
  if (startIdx === -1 || endIdx === -1) return false;
  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + BASTION_MARKER_END.length);
  const cleaned = before + after.replace(/^\n/, '');
  writeFileSync(profilePath, cleaned, 'utf-8');
  return true;
}

function hasProxyBlock(profilePath: string): boolean {
  if (!existsSync(profilePath)) return false;
  const content = readFileSync(profilePath, 'utf-8');
  return content.includes(BASTION_MARKER_START);
}

function insertProxyBlock(profilePath: string, block: string): void {
  removeProxyBlock(profilePath);
  let content = '';
  if (existsSync(profilePath)) {
    content = readFileSync(profilePath, 'utf-8');
    if (!content.endsWith('\n')) content += '\n';
  }
  content += '\n' + block + '\n';
  // Ensure parent directory exists (e.g. PowerShell profile dir on Windows)
  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, content, 'utf-8');
}

// ── macOS system proxy helpers ──

function macGetNetworkService(): string {
  try {
    const output = execSync('networksetup -listallnetworkservices', { encoding: 'utf-8' });
    const services = output.split('\n').filter((l) => l && !l.startsWith('*') && !l.startsWith('An asterisk'));
    for (const preferred of ['Wi-Fi', 'Ethernet']) {
      if (services.includes(preferred)) return preferred;
    }
    return services[0] ?? 'Wi-Fi';
  } catch {
    return 'Wi-Fi';
  }
}

// ── Cross-platform system proxy ──

function getSystemProxyState(): { enabled: boolean; host: string; port: string } {
  if (IS_MAC) {
    try {
      const service = macGetNetworkService();
      const output = execSync(`networksetup -getsecurewebproxy "${service}"`, { encoding: 'utf-8' });
      const enabled = /Enabled:\s*Yes/i.test(output);
      const hostMatch = output.match(/Server:\s*(.+)/);
      const portMatch = output.match(/Port:\s*(\d+)/);
      return {
        enabled,
        host: hostMatch?.[1]?.trim() ?? '',
        port: portMatch?.[1]?.trim() ?? '',
      };
    } catch {
      return { enabled: false, host: '', port: '' };
    }
  }

  if (IS_LINUX) {
    // GNOME desktop
    try {
      const mode = execSync("gsettings get org.gnome.system.proxy mode", { encoding: 'utf-8' }).trim().replace(/'/g, '');
      if (mode === 'manual') {
        const host = execSync("gsettings get org.gnome.system.proxy.https host", { encoding: 'utf-8' }).trim().replace(/'/g, '');
        const port = execSync("gsettings get org.gnome.system.proxy.https port", { encoding: 'utf-8' }).trim();
        return { enabled: true, host, port };
      }
    } catch { /* gsettings not available (headless / non-GNOME) */ }
    return { enabled: false, host: '', port: '' };
  }

  if (IS_WIN) {
    try {
      const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
      const output = execSync(`reg query "${regKey}" /v ProxyEnable`, { encoding: 'utf-8' });
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x0*1\b/.test(output);
      if (enabled) {
        const serverOut = execSync(`reg query "${regKey}" /v ProxyServer`, { encoding: 'utf-8' });
        const match = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
        if (match) {
          const parts = match[1].trim().split(':');
          return { enabled: true, host: parts[0], port: parts[1] ?? '' };
        }
      }
    } catch { /* registry access failed */ }
    return { enabled: false, host: '', port: '' };
  }

  return { enabled: false, host: '', port: '' };
}

function setSystemProxy(host: string, port: number): boolean {
  if (IS_MAC) {
    const service = macGetNetworkService();
    try {
      execSync(`networksetup -setsecurewebproxy "${service}" ${host} ${port}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  if (IS_LINUX) {
    try {
      execSync(`gsettings set org.gnome.system.proxy mode 'manual'`, { stdio: 'pipe' });
      execSync(`gsettings set org.gnome.system.proxy.https host '${host}'`, { stdio: 'pipe' });
      execSync(`gsettings set org.gnome.system.proxy.https port ${port}`, { stdio: 'pipe' });
      return true;
    } catch {
      // gsettings not available — headless server, no system proxy needed
      return false;
    }
  }

  if (IS_WIN) {
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    try {
      execSync(`reg add "${regKey}" /v ProxyEnable /t REG_DWORD /d 1 /f`, { stdio: 'pipe' });
      execSync(`reg add "${regKey}" /v ProxyServer /t REG_SZ /d "${host}:${port}" /f`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function clearSystemProxy(): boolean {
  if (IS_MAC) {
    try {
      const service = macGetNetworkService();
      execSync(`networksetup -setsecurewebproxystate "${service}" off`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  if (IS_LINUX) {
    try {
      execSync(`gsettings set org.gnome.system.proxy mode 'none'`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  if (IS_WIN) {
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    try {
      execSync(`reg add "${regKey}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Remove system proxy if it was set by Bastion.
 * Safe to call from `bastion stop` — only clears if it points to Bastion.
 */
export function clearSystemProxyIfBastion(): void {
  try {
    const config = loadConfig();
    const state = getSystemProxyState();
    if (
      state.enabled &&
      state.host === config.server.host &&
      state.port === String(config.server.port)
    ) {
      clearSystemProxy();
    }
  } catch {
    // Best-effort cleanup
  }
}

// ── CA trust helpers ──

function trustCACert(caCertPath: string): boolean {
  if (IS_MAC) {
    try {
      execSync(
        `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caCertPath}"`,
        { stdio: 'inherit' },
      );
      return true;
    } catch {
      return false;
    }
  }

  if (IS_LINUX) {
    try {
      execSync(`sudo cp "${caCertPath}" /usr/local/share/ca-certificates/bastion-ca.crt`, { stdio: 'inherit' });
      execSync('sudo update-ca-certificates', { stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  if (IS_WIN) {
    try {
      execSync(`certutil -addstore -user Root "${caCertPath}"`, { stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function platformLabel(): string {
  if (IS_MAC) return 'macOS';
  if (IS_LINUX) return 'Linux';
  if (IS_WIN) return 'Windows';
  return process.platform;
}

export function registerProxyCommand(program: Command): void {
  const proxy = program
    .command('proxy')
    .description('Manage global proxy settings to route all AI traffic through Bastion');

  // bastion proxy on
  proxy
    .command('on')
    .description('Enable global proxy — shell profile + system proxy')
    .option('--no-system', 'Skip setting system proxy')
    .option('--trust-ca', 'Also add CA cert to system trust store (requires sudo)')
    .action((options) => {
      const config = loadConfig();
      ensureCA();
      const caCertPath = getCACertPath();
      const baseUrl = `http://${config.server.host}:${config.server.port}`;
      const noProxy = [
        config.server.host,
        'localhost',
        'console.anthropic.com',
        'platform.claude.com',
        'auth.anthropic.com',
      ].join(',');

      const info = (msg: string) => process.stderr.write(msg + '\n');

      // 1. Shell profile
      const profilePath = getShellProfile();
      const block = buildProxyBlock(baseUrl, caCertPath, noProxy);
      insertProxyBlock(profilePath, block);
      info(`Shell profile: ${profilePath} ✓`);

      // 2. System proxy (default on)
      if (options.system !== false) {
        if (setSystemProxy(config.server.host, config.server.port)) {
          info(`${platformLabel()} system proxy → ${baseUrl} ✓`);
        } else {
          if (IS_LINUX) {
            info('System proxy: skipped (no desktop environment or gsettings not available)');
          } else if (IS_WIN) {
            info('System proxy: failed (registry write error)');
          } else {
            info('System proxy: failed (may need admin privileges)');
          }
        }
      }

      // 3. Trust CA in system store
      if (options.trustCa) {
        if (trustCACert(caCertPath)) {
          info(`CA cert trusted in system store ✓`);
        } else {
          info('CA cert: failed to add to system trust store');
        }
      }

      // Check gateway
      const status = getDaemonStatus();
      if (!status.running) {
        info('');
        info('Warning: Bastion gateway is not running. Start it first: bastion start');
      }

      info('');
      info('Global proxy enabled. Already-running processes need to be restarted.');

      // stdout: eval-able commands for current shell
      console.log(emitSet('HTTPS_PROXY', baseUrl));
      console.log(emitSet('NO_PROXY', noProxy));
      console.log(emitSet('NODE_EXTRA_CA_CERTS', caCertPath));
      for (const v of BASE_URL_VARS) {
        console.log(emitSet(v, baseUrl));
      }
    });

  // bastion proxy off
  proxy
    .command('off')
    .description('Disable global proxy — remove shell profile + system proxy')
    .option('--no-system', 'Skip removing system proxy')
    .action((options) => {
      const info = (msg: string) => process.stderr.write(msg + '\n');

      // 1. Shell profile
      const profilePath = getShellProfile();
      const removed = removeProxyBlock(profilePath);
      info(removed
        ? `Shell profile: ${profilePath} cleaned ✓`
        : `Shell profile: no Bastion block found in ${profilePath}`);

      // 2. System proxy (default on)
      if (options.system !== false) {
        clearSystemProxyIfBastion();
        info('System proxy: disabled ✓');
      }

      info('');
      info('Global proxy disabled.');

      // stdout: eval-able unset for current shell
      for (const v of ALL_PROXY_VARS) {
        console.log(emitUnset(v));
      }
    });

  // bastion proxy status
  proxy
    .command('status')
    .description('Show current proxy configuration status')
    .action(() => {
      const config = loadConfig();
      const profilePath = getShellProfile();
      const hasBlock = hasProxyBlock(profilePath);
      const sysProxy = getSystemProxyState();
      const daemonStatus = getDaemonStatus();
      const baseUrl = `http://${config.server.host}:${config.server.port}`;

      console.log('Bastion Proxy Status');
      console.log('─'.repeat(40));
      console.log(`  Gateway:         ${daemonStatus.running ? `running (PID ${daemonStatus.pid})` : 'stopped'}`);
      console.log(`  Listen:          ${baseUrl}`);
      console.log('');
      console.log(`  Shell profile:   ${hasBlock ? 'enabled' : 'disabled'} (${profilePath})`);
      console.log(`  System proxy:    ${sysProxy.enabled ? `${sysProxy.host}:${sysProxy.port}` : 'disabled'}`);
      console.log('');
      console.log(`  Current shell:`);
      console.log(`    HTTPS_PROXY:          ${process.env.HTTPS_PROXY ?? '(not set)'}`);
      console.log(`    NO_PROXY:             ${process.env.NO_PROXY ?? '(not set)'}`);
      console.log(`    NODE_EXTRA_CA_CERTS:  ${process.env.NODE_EXTRA_CA_CERTS ?? '(not set)'}`);
    });
}
