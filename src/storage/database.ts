import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { runMigrations } from './migrations.js';

const log = createLogger('database');

let db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? paths.databaseFile;
  mkdirSync(dirname(resolvedPath), { recursive: true });

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  log.info('Database initialized', { path: resolvedPath });

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Create an in-memory database for testing */
export function createTestDatabase(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  runMigrations(testDb);
  return testDb;
}
