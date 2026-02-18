import type { Command } from 'commander';
import { loadConfig } from '../../config/index.js';
import { getCACertPath } from '../../proxy/certs.js';

export function registerEnvCommand(program: Command): void {
  program
    .command('env')
    .description('Print shell exports to route AI tools through Bastion')
    .option('--fish', 'Output fish shell syntax')
    .option('--powershell', 'Output PowerShell syntax')
    .option('--unset', 'Unset the environment variables')
    .option('--proxy', 'Output HTTPS_PROXY mode (OAuth-compatible, recommended)', true)
    .option('--base-url', 'Output BASE_URL mode (simpler but breaks OAuth)')
    .action((options) => {
      const config = loadConfig();
      const baseUrl = `http://${config.server.host}:${config.server.port}`;
      const caCertPath = getCACertPath();

      // Build variable map based on mode
      const vars: Record<string, string> = {};

      if (options.baseUrl) {
        // Legacy BASE_URL mode (breaks OAuth)
        vars['ANTHROPIC_BASE_URL'] = baseUrl;
        vars['OPENAI_BASE_URL'] = baseUrl;
        vars['GOOGLE_AI_BASE_URL'] = baseUrl;
      } else {
        // HTTPS_PROXY mode (OAuth-compatible, default)
        // Only proxy HTTPS — do NOT set HTTP_PROXY to avoid interfering with OAuth callbacks
        vars['HTTPS_PROXY'] = baseUrl;
        vars['NO_PROXY'] = [
          config.server.host,
          'localhost',
          'a.claude.ai',
          'claude.ai',
          'console.anthropic.com',
          'platform.claude.com',
          'auth.anthropic.com',
        ].join(',');
        vars['NODE_EXTRA_CA_CERTS'] = caCertPath;
      }

      if (options.unset) {
        // Unset ALL Bastion-related env vars (both proxy and base-url modes)
        const allKeys = [
          'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
          'NODE_EXTRA_CA_CERTS',
          'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GOOGLE_AI_BASE_URL',
        ];
        if (options.fish) {
          for (const key of allKeys) {
            console.log(`set -e ${key};`);
          }
        } else if (options.powershell) {
          for (const key of allKeys) {
            console.log(`Remove-Item Env:\\${key} -ErrorAction SilentlyContinue;`);
          }
        } else {
          for (const key of allKeys) {
            console.log(`unset ${key};`);
          }
        }
        return;
      }

      if (options.fish) {
        for (const [key, value] of Object.entries(vars)) {
          console.log(`set -gx ${key} "${value}";`);
        }
      } else if (options.powershell) {
        for (const [key, value] of Object.entries(vars)) {
          console.log(`$env:${key}="${value}";`);
        }
      } else {
        for (const [key, value] of Object.entries(vars)) {
          console.log(`export ${key}="${value}";`);
        }
      }
    });
}
