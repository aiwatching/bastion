/**
 * Layer 1: Entropy Pre-filter
 *
 * Shannon entropy measures information density (randomness) of a string.
 * Secrets and API keys typically have high entropy (4.5–6.0 bits/char),
 * while natural language text averages 3.0–4.0 bits/char.
 *
 * Used as a pre-filter: only high-entropy values proceed to deeper analysis.
 */

/** Calculate Shannon entropy in bits per character */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  let h = 0;
  const len = s.length;
  for (const count of freq.values()) {
    const p = count / len;
    h -= p * Math.log2(p);
  }

  return h;
}

/** Default threshold: values at or above this are likely secrets */
export const DEFAULT_ENTROPY_THRESHOLD = 3.5;

/** Minimum length for entropy analysis to be meaningful */
export const MIN_ENTROPY_LENGTH = 8;

/** Maximum length for a single secret value (longer strings are content, not secrets) */
export const MAX_SECRET_LENGTH = 200;

/** Check if a string likely contains a secret based on entropy */
export function isHighEntropy(s: string, threshold = DEFAULT_ENTROPY_THRESHOLD): boolean {
  return s.length >= MIN_ENTROPY_LENGTH && shannonEntropy(s) >= threshold;
}
