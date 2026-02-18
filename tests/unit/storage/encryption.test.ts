import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../../../src/storage/encryption.js';

describe('Encryption', () => {
  const testKey = randomBytes(32);

  it('encrypts and decrypts correctly', () => {
    const plaintext = 'Hello, World! This is a secret message.';
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const plaintext = 'same input';
    const a = encrypt(plaintext, testKey);
    const b = encrypt(plaintext, testKey);
    expect(a.encrypted).not.toEqual(b.encrypted);
    expect(a.iv).not.toEqual(b.iv);
  });

  it('fails to decrypt with wrong key', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext, testKey);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it('fails to decrypt with tampered data', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext, testKey);
    encrypted.encrypted[0] ^= 0xff; // flip a byte
    expect(() => decrypt(encrypted, testKey)).toThrow();
  });
});
