import { describe, it, expect } from 'vitest';
import { scanText, getPatterns } from '../../../src/dlp/engine.js';

describe('DLP Engine', () => {
  const allPatterns = getPatterns(['high-confidence', 'validated', 'context-aware']);

  it('detects AWS access keys', () => {
    const text = 'My AWS access key is AKIAI44QH8DHBF3KP2XY here';
    const result = scanText(text, allPatterns, 'warn');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.patternName === 'aws-access-key')).toBe(true);
  });

  it('detects GitHub tokens', () => {
    const text = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = scanText(text, allPatterns, 'warn');
    expect(result.findings.some((f) => f.patternName === 'github-token')).toBe(true);
  });

  it('detects private key headers', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCA...';
    const result = scanText(text, allPatterns, 'warn');
    expect(result.findings.some((f) => f.patternName === 'private-key')).toBe(true);
  });

  it('detects credit cards with Luhn validation', () => {
    const text = 'Card: 4111111111111111';
    const result = scanText(text, allPatterns, 'warn');
    expect(result.findings.some((f) => f.patternName === 'credit-card')).toBe(true);
  });

  it('rejects invalid credit cards (fails Luhn)', () => {
    const text = 'Card: 4111111111111112';
    const result = scanText(text, allPatterns, 'warn');
    expect(result.findings.some((f) => f.patternName === 'credit-card')).toBe(false);
  });

  it('detects SSNs', () => {
    const text = 'SSN: 123-45-6789';
    const result = scanText(text, allPatterns, 'warn');
    expect(result.findings.some((f) => f.patternName === 'ssn')).toBe(true);
  });

  it('detects context-aware email only with context', () => {
    const patterns = getPatterns(['context-aware']);
    // Without context word
    const noContext = scanText('john@example.com', patterns, 'warn');
    expect(noContext.findings.length).toBe(0);

    // With context word
    const withContext = scanText('Send email to john@example.com', patterns, 'warn');
    expect(withContext.findings.some((f) => f.patternName === 'email-address')).toBe(true);
  });

  it('redacts findings when action is redact', () => {
    const text = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = scanText(text, allPatterns, 'redact');
    expect(result.action).toBe('redact');
    expect(result.redactedBody).toBeDefined();
    expect(result.redactedBody).toContain('[GITHUB-TOKEN_REDACTED]');
    expect(result.redactedBody).not.toContain('ghp_');
  });

  it('returns pass when no findings', () => {
    const result = scanText('Hello, this is a normal message.', allPatterns, 'block');
    expect(result.action).toBe('pass');
    expect(result.findings).toHaveLength(0);
  });
});
