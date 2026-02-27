import crypto from 'node:crypto';
import { type Command, Option } from 'commander';
import { getDaemonStatus, spawnDaemon } from '../daemon.js';
import { getVersion } from '../../version.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the Bastion AI Gateway')
    .option('--foreground', 'Run in foreground (no daemon)')
    .option('-p, --port <port>', 'Override port')
    .addOption(new Option('--dev').default(false).hideHelp())
    .action(async (options) => {
      if (options.port) {
        process.env.BASTION_PORT = options.port;
      }

      // --dev only works with --foreground
      if (options.dev && !options.foreground) {
        console.error('--dev requires --foreground');
        process.exit(1);
      }

      if (options.dev) {
        process.env.BASTION_DEV = '1';
        const devToken = crypto.randomBytes(16).toString('hex');
        process.env.BASTION_DEV_TOKEN = devToken;
        console.log(`\n  Dev token: ${devToken}`);
        console.log('  Enter this token in Dashboard → Settings → Pro Features to unlock all features\n');
      }

      if (options.foreground) {
        // Import and run server directly
        const { startGateway } = await import('../../index.js');
        await startGateway();
        return;
      }

      // Check if already running
      const status = getDaemonStatus();
      if (status.running) {
        console.log(`Bastion is already running (PID: ${status.pid})`);
        return;
      }

      const version = getVersion();
      const pid = spawnDaemon();
      console.log(`Bastion AI Gateway v${version} started (PID: ${pid})`);
      console.log('Listening on http://127.0.0.1:8420');
      console.log('Dashboard: http://127.0.0.1:8420/dashboard');
      console.log('');
      console.log('Route AI tools through Bastion:');
      console.log('  bastion wrap claude    — Run Claude Code through Bastion');
      console.log('  eval $(bastion env)    — Set proxy env vars in current shell');
      console.log('');
      console.log('Other commands:');
      console.log('  bastion stats    — View usage statistics');
      console.log('  bastion health   — Check gateway health');
      console.log('  bastion stop     — Stop the gateway');
    });
}
