import { sha256 } from '../utils/hash.js';
import { encrypt, decrypt } from '../storage/encryption.js';
import { CacheRepository } from '../storage/repositories/cache.js';
import { createLogger } from '../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('cache');

export class ResponseCache {
  private repo: CacheRepository;

  constructor(db: Database.Database) {
    this.repo = new CacheRepository(db);
  }

  getCacheKey(provider: string, model: string, body: string): string {
    return sha256(`${provider}:${model}:${body}`);
  }

  get(provider: string, model: string, body: string): string | null {
    const key = this.getCacheKey(provider, model, body);
    const record = this.repo.get(key);
    if (!record) return null;

    try {
      const decrypted = decrypt({
        encrypted: record.encrypted_response,
        iv: record.iv,
        authTag: record.auth_tag,
      });
      log.debug('Cache hit', { key, provider, model });
      return decrypted;
    } catch (err) {
      log.warn('Cache decryption failed, evicting entry', { key, error: (err as Error).message });
      return null;
    }
  }

  set(
    provider: string,
    model: string,
    body: string,
    response: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    const key = this.getCacheKey(provider, model, body);
    const { encrypted, iv, authTag } = encrypt(response);

    this.repo.set({
      key,
      provider,
      model,
      encrypted_response: encrypted,
      iv,
      auth_tag: authTag,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });

    log.debug('Cached response', { key, provider, model });
  }

  getStats(): { total_entries: number; total_hits: number } {
    return this.repo.getStats();
  }
}
