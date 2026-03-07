/**
 * Heuristic DLP Validator
 *
 * Local false-positive filter for DLP regex matches.
 * Detects placeholder values, test keys, low-entropy strings, and documentation patterns.
 * Zero external dependencies — replaces the incorrect PI-classifier-based local validation.
 */

import { shannonEntropy } from './entropy.js';

export interface HeuristicContext {
  /** The text matched by the DLP regex */
  matchText: string;
  /** Surrounding context around the match */
  surrounding: string;
  /** DLP pattern name (e.g. 'aws-access-key') */
  patternName: string;
  /** DLP pattern category (e.g. 'high-confidence') */
  patternCategory: string;
}

export interface HeuristicVerdict {
  verdict: 'sensitive' | 'false_positive';
  reason: string;
  confidence: number;
}

// ── Known test values (per provider) ──

const KNOWN_TEST_VALUES = new Set([
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
]);

const KNOWN_TEST_PREFIXES = [
  'sk_test_',
  'pk_test_',
  'rk_test_',
];

// ── Placeholder patterns ──

const PLACEHOLDER_KEYWORDS_RE = /\b(example|test|sample|demo|dummy|placeholder|mock|fake|todo|fixme)\b/i;

const PLACEHOLDER_TEMPLATE_RE = /YOUR_|your_|<YOUR|<your|\[YOUR|\[your|xxx{3,}|XXX{3,}|changeme|change_me|CHANGE_ME|insert.?here|replace.?this/i;

// ── Documentation markers ──

const DOC_MARKER_RE = /\b(e\.g\.|for example|such as|like this|format is|looks like|example:|sample:|returns?:)/i;

// ── Core heuristic function ──

export function heuristicValidate(ctx: HeuristicContext): HeuristicVerdict {
  const { matchText, surrounding } = ctx;

  // Rule 1: Known test values (exact match)
  if (KNOWN_TEST_VALUES.has(matchText)) {
    return fp('Known test/example value', 0.99);
  }

  // Rule 2: Known test prefixes
  for (const prefix of KNOWN_TEST_PREFIXES) {
    if (matchText.startsWith(prefix)) {
      return fp(`Known test prefix: ${prefix}*`, 0.95);
    }
  }

  // Rule 3: Placeholder template in match text
  if (PLACEHOLDER_TEMPLATE_RE.test(matchText)) {
    return fp('Placeholder template in match value', 0.95);
  }

  // Rule 4: Repeated characters (>80% same char)
  if (matchText.length >= 8 && isRepeatedChars(matchText, 0.8)) {
    return fp('Repeated characters', 0.9);
  }

  // Rule 5: Sequential characters (abcdef..., 123456...)
  if (matchText.length >= 8 && isSequentialChars(matchText)) {
    return fp('Sequential characters', 0.9);
  }

  // Rule 6: Placeholder keywords in surrounding context
  if (PLACEHOLDER_KEYWORDS_RE.test(surrounding)) {
    return fp('Placeholder keyword in context', 0.8);
  }

  // Rule 7: Documentation markers in surrounding context
  if (DOC_MARKER_RE.test(surrounding)) {
    return fp('Documentation marker in context', 0.75);
  }

  // Rule 8: Entropy-based checks (only for values long enough)
  if (matchText.length >= 8) {
    const entropy = shannonEntropy(matchText);

    // Low entropy → likely not a real secret
    if (entropy < 2.0) {
      return fp(`Low entropy (${entropy.toFixed(2)})`, 0.85);
    }

    // High entropy + no false-positive indicators → likely real
    if (entropy > 4.0) {
      return { verdict: 'sensitive', reason: `High entropy (${entropy.toFixed(2)}), no false-positive indicators`, confidence: 0.8 };
    }
  }

  // Default: treat as sensitive (fail-closed)
  return { verdict: 'sensitive', reason: 'No false-positive indicators detected', confidence: 0.6 };
}

// ── Helpers ──

function fp(reason: string, confidence: number): HeuristicVerdict {
  return { verdict: 'false_positive', reason, confidence };
}

function isRepeatedChars(s: string, threshold: number): boolean {
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const maxFreq = Math.max(...freq.values());
  return maxFreq / s.length > threshold;
}

function isSequentialChars(s: string): boolean {
  // Check if >=60% of adjacent chars are sequential (code point diff = +-1)
  let sequential = 0;
  for (let i = 1; i < s.length; i++) {
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (diff === 1 || diff === -1) sequential++;
  }
  return sequential / (s.length - 1) >= 0.6;
}
