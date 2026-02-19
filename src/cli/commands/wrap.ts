import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../config/index.js';
import { getCACertPath } from '../../proxy/certs.js';
import { getDaemonStatus } from '../daemon.js';

export function registerWrapCommand(program: Command): void {
  program
    .command('wrap')
    .description('Run a command with AI traffic routed through Bastion')
    .option('--base-url', 'Use BASE_URL mode instead of HTTPS_PROXY (breaks OAuth)')
    .option('--label <label>', 'Human-readable session label')
    .argument('<command...>', 'Command to run (e.g. "claude", "python app.py")')
    .passThroughOptions()
    .allowUnknownOption()
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
      const label = options.label ?? cmd;
      console.log(`Bastion session: ${sessionId} (${label})`);
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
        env.HTTPS_PROXY = `http://${sessionId}@${config.server.host}:${config.server.port}`;
        // Exclude proxy itself, auth/UI domains from proxying
        env.NO_PROXY = [
          config.server.host,
          'localhost',
          'console.anthropic.com',
          'platform.claude.com',
          'auth.anthropic.com',
        ].join(',');
        env.NODE_EXTRA_CA_CERTS = caCertPath;
      }

      const child = spawn(cmd, cmdArgs, {
        stdio: 'inherit',
        env,
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
