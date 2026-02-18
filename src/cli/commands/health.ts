import type { Command } from 'commander';
import { request } from 'node:http';
import { loadConfig } from '../../config/index.js';

export function registerHealthCommand(program: Command): void {
  program
    .command('health')
    .description('Check gateway health')
    .action(() => {
      const config = loadConfig();
      const url = `http://${config.server.host}:${config.server.port}/health`;

      const req = request(url, { method: 'GET', timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const health = JSON.parse(data);
            console.log('Bastion AI Gateway — Health Check');
            console.log('');
            console.log(`  Status:    ${health.status}`);
            console.log(`  PID:       ${health.pid}`);
            console.log(`  Uptime:    ${Math.round(health.uptime)}s`);
            console.log(`  Memory:    ${Math.round(health.memory / 1024 / 1024)}MB`);
            console.log('');
          } catch {
            console.log('Unexpected response from gateway');
          }
        });
      });

      req.on('error', () => {
        console.log('Bastion AI Gateway is not running');
        console.log('Start it with: bastion start');
        process.exitCode = 1;
      });

      req.on('timeout', () => {
        req.destroy();
        console.log('Health check timed out');
        process.exitCode = 1;
      });

      req.end();
    });
}
