import type { Command } from 'commander';
import { getDatabase, closeDatabase } from '../../storage/database.js';
import { RequestsRepository } from '../../storage/repositories/requests.js';
import { CacheRepository } from '../../storage/repositories/cache.js';
import { renderDashboard } from '../../metrics/dashboard.js';

export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show usage statistics')
    .option('--hours <hours>', 'Show stats for last N hours')
    .action((options) => {
      try {
        const db = getDatabase();
        const requestsRepo = new RequestsRepository(db);
        const cacheRepo = new CacheRepository(db);

        const hours = options.hours ? parseInt(options.hours, 10) : undefined;
        const stats = requestsRepo.getStats(hours);
        const cacheStats = cacheRepo.getStats();

        console.log(renderDashboard(stats, cacheStats));
      } catch (err) {
        console.error('Failed to load stats:', (err as Error).message);
        console.error('Is Bastion initialized? Try running: bastion start');
      } finally {
        closeDatabase();
      }
    });
}
