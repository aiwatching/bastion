import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../config/index.js';
import { getCACertPath, getCABundlePath } from '../../proxy/certs.js';
import { getDaemonStatus } from '../daemon.js';

export function registerWrapCommand(program: Command): void {
  program
    .command('wrap')
    .description('Run a command with AI traffic routed through Bastion')
    .option('--base-url', 'Use BASE_URL mode instead of HTTPS_PROXY (breaks OAuth)')
    .option('--agent <name>', 'Agent identity name (registers if new)')
    .option('--label <label>', 'Human-readable session label')
    .argument('<command...>', 'Command to run (e.g. "claude", "python app.py")')
    .passThroughOptions()
    .action((args: string[], options) => {
      // Check if Bastion is running
      const status = getDaemonStatus();
      if (!status.running) {
        console.error('Bastion is not running. Start it first: bastion start');
        process.exitCode = 1;
        return;
      }

      const config = loadConfig();
      const sessionId = randomUUID();
      const [cmd, ...cmdArgs] = args;
      const agentName: string | undefined = options.agent;
      const label = options.label ?? cmd;
      console.log(`Bastion session: ${sessionId} (${label})${agentName ? ` [agent: ${agentName}]` : ''}`);
      const baseUrl = `http://${config.server.host}:${config.server.port}`;
      const caCertPath = getCACertPath();

      // Build environment
      const env: Record<string, string | undefined> = { ...process.env };

      if (options.baseUrl) {
        // Legacy BASE_URL mode
        env.ANTHROPIC_BASE_URL = baseUrl;
        env.OPENAI_BASE_URL = baseUrl;
        env.GOOGLE_AI_BASE_URL = baseUrl;
      } else {
        // HTTPS_PROXY mode (default, OAuth-compatible)
        // Only proxy HTTPS — do NOT set HTTP_PROXY to avoid interfering with OAuth callbacks
        // Encode session ID as username; agent name as password (if provided)
        const userInfo = agentName ? `${sessionId}:${agentName}` : sessionId;
        // Use 127.0.0.1 for proxy target — 0.0.0.0 is a valid listen address
        // but not a valid connect target for all clients (e.g. Rust reqwest)
        const proxyHost = config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host;
        env.HTTPS_PROXY = `http://${userInfo}@${proxyHost}:${config.server.port}`;
        // Exclude proxy itself, auth/UI domains from proxying
        env.NO_PROXY = [
          proxyHost,
          'localhost',
          '127.0.0.1',
          'console.anthropic.com',
          'platform.claude.com',
          'auth.anthropic.com',
        ].join(',');
        env.NODE_EXTRA_CA_CERTS = caCertPath;
        // For non-Node.js TLS stacks (Rust/Go/Python): combined system roots + bastion CA
        env.SSL_CERT_FILE = getCABundlePath();
      }

      const child = spawn(cmd, cmdArgs, {
        stdio: 'inherit',
        env,
        // Windows needs shell:true to find .cmd/.bat/.ps1 commands (e.g. "claude", "node")
        ...(process.platform === 'win32' ? { shell: true } : {}),
      });

      child.on('close', (code) => {
        process.exitCode = code ?? 0;
      });

      child.on('error', (err) => {
        console.error(`Failed to start: ${err.message}`);
        process.exitCode = 1;
      });
    });
}
