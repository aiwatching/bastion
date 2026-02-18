import type { Command } from 'commander';
import { getDaemonStatus, stopDaemon } from '../daemon.js';
import { clearSystemProxyIfBastion } from './proxy.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the Bastion AI Gateway')
    .action(() => {
      const status = getDaemonStatus();
      if (!status.running) {
        console.log('Bastion is not running');
        return;
      }

      const stopped = stopDaemon();
      if (stopped) {
        // Clean up macOS system proxy if it points to Bastion
        // (prevents all traffic from breaking after gateway stops)
        clearSystemProxyIfBastion();

        console.log(`Bastion stopped (was PID: ${status.pid})`);
      } else {
        console.log('Failed to stop Bastion');
      }
    });
}
