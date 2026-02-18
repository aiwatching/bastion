import type { ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { RequestsRepository } from '../storage/repositories/requests.js';
import { CacheRepository } from '../storage/repositories/cache.js';
import { DlpEventsRepository } from '../storage/repositories/dlp-events.js';

export function handleStatsApi(res: ServerResponse, db: Database.Database): void {
  const requestsRepo = new RequestsRepository(db);
  const cacheRepo = new CacheRepository(db);
  const dlpRepo = new DlpEventsRepository(db);

  const stats = requestsRepo.getStats();
  const recent = requestsRepo.getRecent(20);
  const cacheStats = cacheRepo.getStats();
  const dlpStats = dlpRepo.getStats();

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    stats,
    recent,
    cache: cacheStats,
    dlp: dlpStats,
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
  }));
}
