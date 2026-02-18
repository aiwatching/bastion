import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ResponseCache } from '../../../src/optimizer/cache.js';
import { createTestDatabase } from '../../../src/storage/database.js';
import { resetEncryptionKey } from '../../../src/storage/encryption.js';
import type Database from 'better-sqlite3';

// We need to set an encryption key for testing
import * as encryption from '../../../src/storage/encryption.js';

describe('ResponseCache', () => {
  let db: Database.Database;
  let cache: ResponseCache;

  beforeEach(() => {
    resetEncryptionKey();
    // Provide a test key by calling getEncryptionKey with a temp path
    const tmpDir = `/tmp/bastion-test-${Date.now()}`;
    const fs = require('node:fs');
    fs.mkdirSync(tmpDir, { recursive: true });
    encryption.getEncryptionKey(`${tmpDir}/.key`);

    db = createTestDatabase();
    cache = new ResponseCache(db);
  });

  afterEach(() => {
    db.close();
    resetEncryptionKey();
  });

  it('returns null for cache miss', () => {
    const result = cache.get('anthropic', 'claude-haiku-4.5-20241022', '{"test": true}');
    expect(result).toBeNull();
  });

  it('stores and retrieves cached responses', () => {
    const body = '{"model":"claude-haiku-4.5-20241022","messages":[{"role":"user","content":"Hi"}]}';
    const response = '{"id":"msg_123","content":[{"text":"Hello!"}]}';

    cache.set('anthropic', 'claude-haiku-4.5-20241022', body, response, 10, 5);
    const result = cache.get('anthropic', 'claude-haiku-4.5-20241022', body);

    expect(result).toBe(response);
  });

  it('returns different results for different inputs', () => {
    cache.set('anthropic', 'claude-haiku-4.5-20241022', 'body1', 'response1', 10, 5);
    cache.set('anthropic', 'claude-haiku-4.5-20241022', 'body2', 'response2', 10, 5);

    expect(cache.get('anthropic', 'claude-haiku-4.5-20241022', 'body1')).toBe('response1');
    expect(cache.get('anthropic', 'claude-haiku-4.5-20241022', 'body2')).toBe('response2');
  });

  it('tracks cache stats', () => {
    cache.set('anthropic', 'claude-haiku-4.5-20241022', 'body1', 'response1', 10, 5);
    cache.get('anthropic', 'claude-haiku-4.5-20241022', 'body1');

    const stats = cache.getStats();
    expect(stats.total_entries).toBe(1);
    expect(stats.total_hits).toBeGreaterThanOrEqual(1);
  });
});
