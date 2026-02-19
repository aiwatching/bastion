import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig } from '../../config/index.js';
import { getCACertPath, ensureCA } from '../../proxy/certs.js';
import { getDaemonStatus } from '../daemon.js';

const BASTION_MARKER_START = '# >>> bastion proxy >>>';
const BASTION_MARKER_END = '# <<< bastion proxy <<<';

function getShellProfile(): string {
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

function isFish(): boolean {
  return (process.env.SHELL ?? '').endsWith('fish');
}

// All env vars set by bastion proxy on
const BASE_URL_VARS = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GOOGLE_AI_BASE_URL'];
const ALL_PROXY_VARS = [
  'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
  ...BASE_URL_VARS,
];

function buildProxyBlock(baseUrl: string, caCertPath: string, noProxy: string): string {
  const lines = [BASTION_MARKER_START];
  const setCmd = isFish() ? 'set -gx' : 'export';
  const eq = isFish() ? ' ' : '=';

  // Standard proxy (for tools that respect HTTPS_PROXY)
  lines.push(`${setCmd} HTTPS_PROXY${eq}"${baseUrl}";`);
  lines.push(`${setCmd} NO_PROXY${eq}"${noProxy}";`);
  lines.push(`${setCmd} NODE_EXTRA_CA_CERTS${eq}"${caCertPath}";`);

  // SDK-specific base URLs (for tools that only check their own env var)
  for (const v of BASE_URL_VARS) {
    lines.push(`${setCmd} ${v}${eq}"${baseUrl}";`);
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
  writeFileSync(profilePath, content, 'utf-8');
}

function getNetworkService(): string {
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

function getSystemProxyState(): { enabled: boolean; host: string; port: string } {
  try {
    const service = getNetworkService();
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

function setSystemProxy(host: string, port: number): boolean {
  const service = getNetworkService();
  try {
    execSync(`networksetup -setsecurewebproxy "${service}" ${host} ${port}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove macOS system proxy if it was set by Bastion.
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
      const service = getNetworkService();
      execSync(`networksetup -setsecurewebproxystate "${service}" off`, { stdio: 'pipe' });
    }
  } catch {
    // Best-effort cleanup
  }
}

export function registerProxyCommand(program: Command): void {
  const proxy = program
    .command('proxy')
    .description('Manage global proxy settings to route all AI traffic through Bastion');

  // bastion proxy on
  proxy
    .command('on')
    .description('Enable global proxy — shell profile + macOS system proxy')
    .option('--no-system', 'Skip setting macOS system proxy')
    .option('--trust-ca', 'Also add CA cert to macOS system keychain (requires sudo)')
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

      // 2. macOS system proxy (default on)
      if (options.system !== false) {
        if (setSystemProxy(config.server.host, config.server.port)) {
          info(`macOS system proxy → ${baseUrl} ✓`);
        } else {
          info('macOS system proxy: failed (may need admin privileges)');
        }
      }

      // 3. Trust CA in system keychain
      if (options.trustCa) {
        try {
          execSync(
            `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caCertPath}"`,
            { stdio: 'inherit' },
          );
          info(`CA cert trusted in system keychain ✓`);
        } catch {
          info('CA cert: failed to add to system keychain');
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
      const setCmd = isFish() ? 'set -gx' : 'export';
      const eq = isFish() ? ' ' : '=';
      console.log(`${setCmd} HTTPS_PROXY${eq}"${baseUrl}";`);
      console.log(`${setCmd} NO_PROXY${eq}"${noProxy}";`);
      console.log(`${setCmd} NODE_EXTRA_CA_CERTS${eq}"${caCertPath}";`);
      for (const v of BASE_URL_VARS) {
        console.log(`${setCmd} ${v}${eq}"${baseUrl}";`);
      }
    });

  // bastion proxy off
  proxy
    .command('off')
    .description('Disable global proxy — remove shell profile + macOS system proxy')
    .option('--no-system', 'Skip removing macOS system proxy')
    .action((options) => {
      const info = (msg: string) => process.stderr.write(msg + '\n');

      // 1. Shell profile
      const profilePath = getShellProfile();
      const removed = removeProxyBlock(profilePath);
      info(removed
        ? `Shell profile: ${profilePath} cleaned ✓`
        : `Shell profile: no Bastion block found in ${profilePath}`);

      // 2. macOS system proxy (default on)
      if (options.system !== false) {
        clearSystemProxyIfBastion();
        info('macOS system proxy: disabled ✓');
      }

      info('');
      info('Global proxy disabled.');

      // stdout: eval-able unset for current shell
      for (const v of ALL_PROXY_VARS) {
        console.log(isFish() ? `set -e ${v};` : `unset ${v};`);
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
