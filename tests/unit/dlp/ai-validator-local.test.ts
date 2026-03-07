import { describe, it, expect, beforeEach } from 'vitest';
import { AiValidator, type AiValidatorConfig } from '../../../src/dlp/ai-validator.js';
import type { DlpFinding } from '../../../src/dlp/actions.js';

function makeFinding(overrides: Partial<DlpFinding> = {}): DlpFinding {
  return {
    patternName: 'aws-access-key',
    patternCategory: 'high-confidence',
    matches: ['AKIAIOSFODNN7EXAMPLE'],
    matchCount: 1,
    ...overrides,
  };
}

describe('AiValidator: local provider (heuristic)', () => {
  let config: AiValidatorConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      provider: 'local',
      model: '',
      apiKey: '',
      timeoutMs: 5000,
      cacheSize: 100,
    };
  });

  describe('ready getter', () => {
    it('returns true when provider is local (heuristic always available)', () => {
      const validator = new AiValidator(config);
      expect(validator.ready).toBe(true);
    });

    it('returns false when disabled', () => {
      config.enabled = false;
      const validator = new AiValidator(config);
      expect(validator.ready).toBe(false);
    });
  });

  describe('validate with heuristic', () => {
    it('filters known test value AKIAIOSFODNN7EXAMPLE as false positive', async () => {
      const validator = new AiValidator(config);
      const findings = [makeFinding()];
      const text = 'The key is AKIAIOSFODNN7EXAMPLE in this doc';

      const confirmed = await validator.validate(findings, text);
      expect(confirmed).toHaveLength(0);
    });

    it('filters Stripe test key as false positive', async () => {
      const validator = new AiValidator(config);
      const findings = [makeFinding({
        patternName: 'stripe-secret-key',
        patternCategory: 'high-confidence',
        matches: ['sk_test_4eC39HqLyjWDarjtT1zdp7dc'],
      })];
      const text = 'stripe.api_key = "sk_test_4eC39HqLyjWDarjtT1zdp7dc"';

      const confirmed = await validator.validate(findings, text);
      expect(confirmed).toHaveLength(0);
    });

    it('confirms real high-entropy key as sensitive', async () => {
      const validator = new AiValidator(config);
      const findings = [makeFinding({
        matches: ['AKIAZ3MTHHDYT7Q9XRVW'],
      })];
      const text = 'aws_access_key_id = "AKIAZ3MTHHDYT7Q9XRVW"';

      const confirmed = await validator.validate(findings, text);
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].patternName).toBe('aws-access-key');
    });

    it('filters match with "example" in context', async () => {
      const validator = new AiValidator(config);
      const findings = [makeFinding({
        matches: ['AKIAZ3MTH7Q9XRVWTEST'],
      })];
      const text = 'Here is an example AWS key: AKIAZ3MTH7Q9XRVWTEST';

      const confirmed = await validator.validate(findings, text);
      expect(confirmed).toHaveLength(0);
    });
  });

  describe('caching', () => {
    it('caches heuristic results and reuses on second call', async () => {
      const validator = new AiValidator(config);
      const findings = [makeFinding()];
      const text = 'text with AKIAIOSFODNN7EXAMPLE';

      const r1 = await validator.validate(findings, text);
      const r2 = await validator.validate(findings, text);

      // Both calls should give same result
      expect(r1).toHaveLength(0);
      expect(r2).toHaveLength(0);
    });
  });

  describe('multiple findings', () => {
    it('validates each finding independently', async () => {
      const validator = new AiValidator(config);
      const findings = [
        makeFinding({ patternName: 'aws-key', matches: ['AKIAIOSFODNN7EXAMPLE'] }),
        makeFinding({ patternName: 'github-token', matches: ['ghp_a8Kz9mN2xQ7vR5tL4wJ6yP3bF1dH0cE5sU'] }),
      ];

      const text = 'AKIAIOSFODNN7EXAMPLE and ghp_a8Kz9mN2xQ7vR5tL4wJ6yP3bF1dH0cE5sU';
      const confirmed = await validator.validate(findings, text);

      // AKIAIOSFODNN7EXAMPLE = known test value → filtered
      // ghp_ + high entropy → sensitive
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].patternName).toBe('github-token');
    });
  });
});
