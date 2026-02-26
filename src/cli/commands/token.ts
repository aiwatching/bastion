import type { Command } from 'commander';
import { loadConfig } from '../../config/index.js';

function mask(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '...' + token.slice(-4);
}

export function registerTokenCommand(program: Command): void {
  program
    .command('token')
    .description('Show the dashboard auth token')
    .option('--reveal', 'Show the full token (default: masked)')
    .action((opts) => {
      const config = loadConfig();
      const token = config.server.auth?.token;

      if (!token) {
        console.log('No token configured. A random token is generated on each start.');
        console.log('Check the startup log output for the generated token.');
        return;
      }

      if (opts.reveal) {
        console.log(token);
      } else {
        console.log(mask(token));
        console.log('  (use --reveal to show full token)');
      }
    });
}
