import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { loadConfig } from '../../config/index.js';
import { paths } from '../../config/paths.js';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Show current configuration')
    .action(() => {
      console.log('Bastion AI Gateway — Configuration');
      console.log('');
      console.log(`  Config dir:  ${paths.bastionDir}`);
      console.log(`  Config file: ${paths.configFile} ${existsSync(paths.configFile) ? '(exists)' : '(using defaults)'}`);
      console.log(`  Database:    ${paths.databaseFile}`);
      console.log(`  PID file:    ${paths.pidFile}`);
      console.log('');

      const config = loadConfig();
      console.log('  Active Configuration:');
      console.log(`    Server:     ${config.server.host}:${config.server.port}`);
      console.log(`    Log level:  ${config.logging.level}`);
      console.log(`    Metrics:    ${config.plugins.metrics.enabled ? 'enabled' : 'disabled'}`);
      console.log(`    DLP:        ${config.plugins.dlp.enabled ? config.plugins.dlp.action : 'disabled'}`);
      console.log(`    Optimizer:  ${config.plugins.optimizer.enabled ? 'enabled' : 'disabled'}`);
      console.log(`    Cache:      ${config.plugins.optimizer.cache ? 'enabled' : 'disabled'}`);
      console.log(`    Timeouts:   upstream=${config.timeouts.upstream}ms, plugin=${config.timeouts.plugin}ms`);
      console.log('');
    });
}
