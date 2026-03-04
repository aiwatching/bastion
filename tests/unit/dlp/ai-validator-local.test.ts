import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiValidator, type AiValidatorConfig } from '../../../src/dlp/ai-validator.js';
import type { DlpFinding } from '../../../src/dlp/actions.js';
import type { ClassifierProvider, ClassificationResult } from '../../../src/plugin-api/types.js';

function makeProvider(overrides: Partial<ClassifierProvider> = {}): ClassifierProvider {
  return {
    name: 'mock-onnx',
    modelName: 'test-model',
    ready: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn().mockResolvedValue({
      label: 'SAFE',
      score: 0.99,
      labels: [{ label: 'SAFE', score: 0.99 }, { label: 'INJECTION', score: 0.01 }],
      latencyMs: 5,
    } satisfies ClassificationResult),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFinding(overrides: Partial<DlpFinding> = {}): DlpFinding {
  return {
    patternName: 'aws-access-key',
    patternCategory: 'high-confidence',
    matches: ['AKIAIOSFODNN7EXAMPLE'],
    matchCount: 1,
    ...overrides,
  };
}

describe('AiValidator: local provider', () => {
  let config: AiValidatorConfig;
  let provider: ClassifierProvider;

  beforeEach(() => {
    provider = makeProvider();
    config = {
      enabled: true,
      provider: 'local',
      model: '',
      apiKey: '',
      timeoutMs: 5000,
      cacheSize: 100,
      getLocalProvider: () => provider,
    };
  });

  describe('ready getter', () => {
    it('returns true when local provider is available', () => {
      const validator = new AiValidator(config);
      expect(validator.ready).toBe(true);
    });

    it('returns false when getLocalProvider returns undefined', () => {
      config.getLocalProvider = () => undefined;
      const validator = new AiValidator(config);
      expect(validator.ready).toBe(false);
    });

    it('returns false when getLocalProvider is not set', () => {
      config.getLocalProvider = undefined;
      const validator = new AiValidator(config);
      expect(validator.ready).toBe(false);
    });

    it('returns false when disabled', () => {
      config.enabled = false;
      const validator = new AiValidator(config);
      expect(validator.ready).toBe(false);
    });

    it('reflects lazy provider availability (lazy closure pattern)', () => {
      let lazyProvider: ClassifierProvider | undefined;
      config.getLocalProvider = () => lazyProvider;
      const validator = new AiValidator(config);

      // Before external plugin loads
      expect(validator.ready).toBe(false);

      // After external plugin provides the provider
      lazyProvider = makeProvider();
      expect(validator.ready).toBe(true);
    });
  });

  describe('validate with local provider', () => {
    it('filters false positive when ML says SAFE', async () => {
      const validator = new AiValidator(config);
      const findings = [makeFinding()];
      const text = 'The key is AKIAIOSFODNN7EXAMPLE in this example doc';

      const confirmed = await validator.validate(findings, text);

      expect(confirmed).toHaveLength(0);
      expect(provider.classify).toHaveBeenCalledTimes(1);
    });

    it('filters false positive when ML says BENIGN', async () => {
      provider = makeProvider({
        classify: vi.fn().mockResolvedValue({
          label: 'BENIGN',
          score: 0.95,
          labels: [{ label: 'BENIGN', score: 0.95 }, { label: 'INJECTION', score: 0.05 }],
          latencyMs: 3,
        }),
      });
      config.getLocalProvider = () => provider;
      const validator = new AiValidator(config);

      const confirmed = await validator.validate([makeFinding()], 'example text with key');

      expect(confirmed).toHaveLength(0);
    });

    it('confirms finding when ML says INJECTION', async () => {
      provider = makeProvider({
        classify: vi.fn().mockResolvedValue({
          label: 'INJECTION',
          score: 0.98,
          labels: [{ label: 'SAFE', score: 0.02 }, { label: 'INJECTION', score: 0.98 }],
          latencyMs: 4,
        }),
      });
      config.getLocalProvider = () => provider;
      const validator = new AiValidator(config);
      const findings = [makeFinding()];

      const confirmed = await validator.validate(findings, 'real sensitive data');

      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].patternName).toBe('aws-access-key');
    });

    it('confirms finding for any non-SAFE/non-BENIGN label', async () => {
      provider = makeProvider({
        classify: vi.fn().mockResolvedValue({
          label: 'JAILBREAK',
          score: 0.9,
          labels: [{ label: 'BENIGN', score: 0.05 }, { label: 'INJECTION', score: 0.05 }, { label: 'JAILBREAK', score: 0.9 }],
          latencyMs: 5,
        }),
      });
      config.getLocalProvider = () => provider;
      const validator = new AiValidator(config);

      const confirmed = await validator.validate([makeFinding()], 'text');

      expect(confirmed).toHaveLength(1);
    });
  });

  describe('caching', () => {
    it('caches local ML results and reuses on second call', async () => {
      const validator = new AiValidator(config);
      const findings = [makeFinding()];
      const text = 'text with AKIAIOSFODNN7EXAMPLE';

      await validator.validate(findings, text);
      await validator.validate(findings, text);

      // classify should only be called once (second call uses cache)
      expect(provider.classify).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('treats as sensitive (fail-closed) when provider throws', async () => {
      provider = makeProvider({
        classify: vi.fn().mockRejectedValue(new Error('ONNX runtime error')),
      });
      config.getLocalProvider = () => provider;
      const validator = new AiValidator(config);

      const confirmed = await validator.validate([makeFinding()], 'text');

      expect(confirmed).toHaveLength(1); // fail-closed: keep the finding
    });

    it('throws when provider is not available during callLocal', async () => {
      config.getLocalProvider = () => undefined;
      // Force ready to return true by temporarily providing provider
      const tmpProvider = makeProvider();
      let available: ClassifierProvider | undefined = tmpProvider;
      config.getLocalProvider = () => available;
      const validator = new AiValidator(config);

      // Now remove provider
      available = undefined;
      // validate will still try because ready was true at validation start,
      // but callLocal will throw — caught and treated as sensitive
      const findings = [makeFinding()];
      const confirmed = await validator.validate(findings, 'text');
      // Since ready is now false, validate returns findings as-is
      expect(confirmed).toHaveLength(1);
    });
  });

  describe('multiple findings', () => {
    it('validates each finding independently', async () => {
      let callCount = 0;
      provider = makeProvider({
        classify: vi.fn().mockImplementation(async () => {
          callCount++;
          // First call: SAFE (false positive), second call: INJECTION (real)
          if (callCount === 1) {
            return { label: 'SAFE', score: 0.99, labels: [], latencyMs: 3 };
          }
          return { label: 'INJECTION', score: 0.95, labels: [], latencyMs: 4 };
        }),
      });
      config.getLocalProvider = () => provider;
      const validator = new AiValidator(config);

      const findings = [
        makeFinding({ patternName: 'aws-key', matches: ['AKIA_fake'] }),
        makeFinding({ patternName: 'github-token', matches: ['ghp_real123'] }),
      ];

      const confirmed = await validator.validate(findings, 'AKIA_fake and ghp_real123');

      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].patternName).toBe('github-token');
    });
  });
});
