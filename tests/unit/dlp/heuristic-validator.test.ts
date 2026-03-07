import { describe, it, expect } from 'vitest';
import { heuristicValidate, type HeuristicContext } from '../../../src/dlp/heuristic-validator.js';

function ctx(overrides: Partial<HeuristicContext> = {}): HeuristicContext {
  return {
    matchText: 'AKIAZ3MTHHDYTABCDEFG',
    surrounding: 'const key = "AKIAZ3MTHHDYTABCDEFG";',
    patternName: 'aws-access-key',
    patternCategory: 'high-confidence',
    ...overrides,
  };
}

describe('heuristicValidate', () => {
  // ── True positives (should be 'sensitive') ──

  it('flags real high-entropy AWS key as sensitive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'AKIAZ3MTHHDYT7Q9XRVW',
      surrounding: 'aws_access_key_id = "AKIAZ3MTHHDYT7Q9XRVW"',
    }));
    expect(result.verdict).toBe('sensitive');
  });

  it('flags real high-entropy GitHub PAT as sensitive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'ghp_a8Kz9mN2xQ7vR5tL4wJ6yP3bF1dH0cE5sU',
      surrounding: 'GITHUB_TOKEN=ghp_a8Kz9mN2xQ7vR5tL4wJ6yP3bF1dH0cE5sU',
      patternName: 'github-pat',
    }));
    expect(result.verdict).toBe('sensitive');
  });

  // ── Known test values ──

  it('detects AKIAIOSFODNN7EXAMPLE as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'AKIAIOSFODNN7EXAMPLE',
      surrounding: 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('Known test');
  });

  it('detects AWS example secret key as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      surrounding: 'aws_secret = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      patternName: 'aws-secret-key',
    }));
    expect(result.verdict).toBe('false_positive');
  });

  it('detects Stripe test key as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
      surrounding: 'stripe.api_key = "sk_test_4eC39HqLyjWDarjtT1zdp7dc"',
      patternName: 'stripe-secret-key',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('test prefix');
  });

  it('detects pk_test_ key as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'pk_test_TYooMQauvdEDq54NiTphI7jx',
      surrounding: 'publishable_key = pk_test_TYooMQauvdEDq54NiTphI7jx',
      patternName: 'stripe-publishable-key',
    }));
    expect(result.verdict).toBe('false_positive');
  });

  // ── Placeholder templates ──

  it('detects YOUR_API_KEY_HERE as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'YOUR_API_KEY_HERE',
      surrounding: 'Set your key: YOUR_API_KEY_HERE',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('Placeholder template');
  });

  it('detects <YOUR_SECRET> as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: '<YOUR_SECRET_KEY>',
      surrounding: 'api_key: <YOUR_SECRET_KEY>',
    }));
    expect(result.verdict).toBe('false_positive');
  });

  it('detects changeme as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'changeme_password_here',
      surrounding: 'password = changeme_password_here',
    }));
    expect(result.verdict).toBe('false_positive');
  });

  // ── Placeholder keywords in context ──

  it('detects "example" in context as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'AKIAZ3MTH7Q9XRVWTEST',
      surrounding: 'Here is an example AWS key: AKIAZ3MTH7Q9XRVWTEST',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('Placeholder keyword');
  });

  it('detects "demo" in context as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'ghp_a8Kz9mN2xQ7vR5tL4w',
      surrounding: 'This is a demo token: ghp_a8Kz9mN2xQ7vR5tL4w',
      patternName: 'github-pat',
    }));
    expect(result.verdict).toBe('false_positive');
  });

  // ── Documentation markers ──

  it('detects "e.g." in context as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'sk_live_abcdef123456789x',
      surrounding: 'Provide your Stripe key, e.g. sk_live_abcdef123456789x',
      patternName: 'stripe-secret-key',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('Documentation marker');
  });

  it('detects "for example" in context as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'AKIAZ3MTH7Q9XRVWABC1',
      surrounding: 'For example, AKIAZ3MTH7Q9XRVWABC1 would be a valid key',
    }));
    expect(result.verdict).toBe('false_positive');
  });

  // ── Repeated characters ──

  it('detects repeated characters as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'AAAAAAAAAAAAAAAAAAAAA',
      surrounding: 'key = AAAAAAAAAAAAAAAAAAAAA',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('Repeated');
  });

  // ── Sequential characters ──

  it('detects sequential characters as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: 'abcdefghijklmnopqrst',
      surrounding: 'token = abcdefghijklmnopqrst',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('Sequential');
  });

  it('detects numeric sequence as false positive', () => {
    const result = heuristicValidate(ctx({
      matchText: '12345678901234567890',
      surrounding: 'id = 12345678901234567890',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('Sequential');
  });

  // ── Entropy checks ──

  it('detects low entropy long string as false positive', () => {
    // 'aabbaabb...' has low entropy but won't trigger sequential rule
    const result = heuristicValidate(ctx({
      matchText: 'aabbaabbaabbaabb',
      surrounding: 'key = aabbaabbaabbaabb',
    }));
    expect(result.verdict).toBe('false_positive');
    expect(result.reason).toContain('entropy');
  });

  // ── Default fail-closed ──

  it('treats medium-entropy match without indicators as sensitive', () => {
    // Medium entropy, no context clues — fail-closed
    const result = heuristicValidate(ctx({
      matchText: 'xK9m2pQ7',
      surrounding: 'auth: xK9m2pQ7',
    }));
    expect(result.verdict).toBe('sensitive');
  });
});
