import { describe, it, expect } from 'vitest';
import { luhnCheck, ssnCheck } from '../../../src/dlp/validators.js';

describe('Luhn Check', () => {
  it('validates a correct Visa card', () => {
    expect(luhnCheck('4111111111111111')).toBe(true);
  });

  it('validates a correct MasterCard', () => {
    expect(luhnCheck('5500000000000004')).toBe(true);
  });

  it('rejects an invalid number', () => {
    expect(luhnCheck('4111111111111112')).toBe(false);
  });

  it('rejects numbers that are too short', () => {
    expect(luhnCheck('411111')).toBe(false);
  });
});

describe('SSN Check', () => {
  it('validates a correct SSN', () => {
    expect(ssnCheck('123-45-6789')).toBe(true);
  });

  it('rejects area 000', () => {
    expect(ssnCheck('000-45-6789')).toBe(false);
  });

  it('rejects area 666', () => {
    expect(ssnCheck('666-45-6789')).toBe(false);
  });

  it('rejects area >= 900', () => {
    expect(ssnCheck('900-45-6789')).toBe(false);
  });

  it('rejects group 00', () => {
    expect(ssnCheck('123-00-6789')).toBe(false);
  });

  it('rejects serial 0000', () => {
    expect(ssnCheck('123-45-0000')).toBe(false);
  });
});
