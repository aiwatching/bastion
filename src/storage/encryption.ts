import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../config/paths.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

export function getEncryptionKey(keyPath?: string): Buffer {
  if (encryptionKey) return encryptionKey;

  const resolvedPath = keyPath ?? paths.encryptionKeyFile;

  if (existsSync(resolvedPath)) {
    encryptionKey = readFileSync(resolvedPath);
  } else {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    encryptionKey = randomBytes(32);
    writeFileSync(resolvedPath, encryptionKey, { mode: 0o600 });
  }

  return encryptionKey;
}

export interface EncryptedData {
  encrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: string, key?: Buffer): EncryptedData {
  const k = key ?? getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, k, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag };
}

export function decrypt(data: EncryptedData, key?: Buffer): string {
  const k = key ?? getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, k, data.iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(data.authTag);

  return decipher.update(data.encrypted) + decipher.final('utf-8');
}

/** Reset the cached key (for testing) */
export function resetEncryptionKey(): void {
  encryptionKey = null;
}
