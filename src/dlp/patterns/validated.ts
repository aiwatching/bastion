import type { DlpPattern } from '../engine.js';

/** Validated patterns: regex match + structural validation (Luhn, etc.) */
export const validatedPatterns: DlpPattern[] = [
  {
    name: 'credit-card',
    category: 'validated',
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    description: 'Credit Card Number (Visa, MC, Amex, Discover)',
    validator: 'luhn',
  },
  {
    name: 'ssn',
    category: 'validated',
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    description: 'US Social Security Number',
    validator: 'ssn',
  },
];
