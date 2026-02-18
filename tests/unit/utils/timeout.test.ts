import { describe, it, expect } from 'vitest';
import { withTimeout, TimeoutError } from '../../../src/utils/timeout.js';

describe('withTimeout', () => {
  it('resolves if promise completes within timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('rejects with TimeoutError if promise exceeds timeout', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 10)).rejects.toThrow(TimeoutError);
  });

  it('propagates the original error if promise rejects before timeout', async () => {
    const failing = Promise.reject(new Error('original'));
    await expect(withTimeout(failing, 1000)).rejects.toThrow('original');
  });
});
