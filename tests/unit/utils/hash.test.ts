import { describe, it, expect } from 'vitest';
import { sha256 } from '../../../src/utils/hash.js';

describe('sha256', () => {
  it('produces consistent hashes', () => {
    const hash = sha256('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});
