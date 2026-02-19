import { validators } from './validators.js';
import type { DlpAction, DlpFinding, DlpResult } from './actions.js';
import { highConfidencePatterns } from './patterns/high-confidence.js';
import { validatedPatterns } from './patterns/validated.js';
import { contextAwarePatterns } from './patterns/context-aware.js';

export interface DlpPattern {
  name: string;
  category: string;
  regex: RegExp;
  description: string;
  validator?: string;
  requireContext?: string[];
}

const PATTERN_TIMEOUT_MS = 10;

function runRegexWithPositions(regex: RegExp, text: string, timeoutMs: number): { match: string; index: number }[] {
  const results: { match: string; index: number }[] = [];
  const start = Date.now();
  const cloned = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;
  while ((match = cloned.exec(text)) !== null) {
    results.push({ match: match[0], index: match.index });
    if (Date.now() - start > timeoutMs) break;
    if (match.index === cloned.lastIndex) cloned.lastIndex++;
  }
  return results;
}

function runRegexWithTimeout(regex: RegExp, text: string, timeoutMs: number): string[] {
  const matches: string[] = [];
  const start = Date.now();

  // Clone regex to reset lastIndex
  const cloned = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;

  while ((match = cloned.exec(text)) !== null) {
    matches.push(match[0]);
    if (Date.now() - start > timeoutMs) break;
    // Prevent infinite loops on zero-length matches
    if (match.index === cloned.lastIndex) cloned.lastIndex++;
  }

  return matches;
}

const CONTEXT_RADIUS = 200; // chars around match to look for context words

function hasContext(text: string, contextWords: string[]): boolean {
  const lower = text.toLowerCase();
  return contextWords.some((word) => lower.includes(word.toLowerCase()));
}

/** Check if any context word appears within CONTEXT_RADIUS chars of the match position */
function hasNearbyContext(text: string, matchIndex: number, matchLength: number, contextWords: string[]): boolean {
  const start = Math.max(0, matchIndex - CONTEXT_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + CONTEXT_RADIUS);
  const nearby = text.slice(start, end).toLowerCase();
  return contextWords.some((word) => nearby.includes(word.toLowerCase()));
}

export function getPatterns(categories: string[]): DlpPattern[] {
  const all: DlpPattern[] = [];
  const catSet = new Set(categories);
  if (catSet.has('high-confidence')) all.push(...highConfidencePatterns);
  if (catSet.has('validated')) all.push(...validatedPatterns);
  if (catSet.has('context-aware')) all.push(...contextAwarePatterns);
  return all;
}

export function scanText(text: string, patterns: DlpPattern[], action: DlpAction): DlpResult {
  const findings: DlpFinding[] = [];
  let redactedBody = text;

  for (const pattern of patterns) {
    // Quick pre-check: if context words don't appear anywhere, skip entirely
    if (pattern.requireContext && !hasContext(text, pattern.requireContext)) {
      continue;
    }

    let matches: string[];

    if (pattern.requireContext) {
      // For context-dependent patterns, filter matches by nearby context
      matches = runRegexWithPositions(pattern.regex, text, PATTERN_TIMEOUT_MS)
        .filter((m) => hasNearbyContext(text, m.index, m.match.length, pattern.requireContext!))
        .map((m) => m.match);
    } else {
      matches = runRegexWithTimeout(pattern.regex, text, PATTERN_TIMEOUT_MS);
    }

    if (matches.length === 0) continue;

    // Run validator if one is specified
    const validatedMatches = pattern.validator
      ? matches.filter((m) => validators[pattern.validator!]?.(m) ?? true)
      : matches;

    if (validatedMatches.length === 0) continue;

    findings.push({
      patternName: pattern.name,
      patternCategory: pattern.category,
      matchCount: validatedMatches.length,
      matches: validatedMatches,
    });

    // Apply redaction if needed
    if (action === 'redact') {
      for (const m of validatedMatches) {
        redactedBody = redactedBody.replaceAll(m, `[${pattern.name.toUpperCase()}_REDACTED]`);
      }
    }
  }

  if (findings.length === 0) {
    return { action: 'pass', findings: [] };
  }

  return {
    action,
    findings,
    redactedBody: action === 'redact' ? redactedBody : undefined,
  };
}
