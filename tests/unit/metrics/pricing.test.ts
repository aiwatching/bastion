import { describe, it, expect } from 'vitest';
import { getModelPricing, calculateCost } from '../../../src/metrics/pricing.js';

describe('Pricing', () => {
  it('returns pricing for known models', () => {
    const pricing = getModelPricing('claude-haiku-4.5-20241022');
    expect(pricing).toBeDefined();
    expect(pricing!.inputPerMillion).toBe(0.80);
    expect(pricing!.outputPerMillion).toBe(4);
  });

  it('returns pricing for OpenAI models', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing).toBeDefined();
    expect(pricing!.inputPerMillion).toBe(2.5);
  });

  it('returns undefined for unknown models', () => {
    expect(getModelPricing('unknown-model-xyz')).toBeUndefined();
  });

  it('calculates cost correctly', () => {
    // 1000 input tokens of claude-haiku-4.5 at $0.80/M = $0.0008
    // 500 output tokens at $4/M = $0.002
    const cost = calculateCost('claude-haiku-4.5-20241022', 1000, 500);
    expect(cost).toBeCloseTo(0.0028, 4);
  });

  it('returns 0 cost for unknown models', () => {
    expect(calculateCost('unknown-model', 1000, 500)).toBe(0);
  });

  it('includes cache token costs', () => {
    const withoutCache = calculateCost('claude-haiku-4.5-20241022', 1000, 500, 0, 0);
    const withCache = calculateCost('claude-haiku-4.5-20241022', 1000, 500, 500, 200);
    expect(withCache).toBeGreaterThan(withoutCache);
  });
});
