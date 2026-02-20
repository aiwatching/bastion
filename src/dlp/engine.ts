import { validators } from './validators.js';
import type { DlpAction, DlpFinding, DlpResult } from './actions.js';
import { highConfidencePatterns } from './patterns/high-confidence.js';
import { validatedPatterns } from './patterns/validated.js';
import { contextAwarePatterns } from './patterns/context-aware.js';
import { extractStructuredFields } from './structure.js';
import { shannonEntropy, isHighEntropy, DEFAULT_ENTROPY_THRESHOLD, MAX_SECRET_LENGTH, MIN_ENTROPY_LENGTH } from './entropy.js';
import { isSensitiveFieldName } from './semantics.js';

export interface DlpTraceEntry {
  layer: number;
  layerName: string;
  step: string;
  detail: string;
  durationMs?: number;
}

export interface DlpTrace {
  entries: DlpTraceEntry[];
  totalDurationMs: number;
}

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

export function scanText(text: string, patterns: DlpPattern[], action: DlpAction, trace?: DlpTrace): DlpResult {
  const findings: DlpFinding[] = [];
  let redactedBody = text;
  const t0 = trace ? performance.now() : 0;

  if (trace) {
    trace.entries.push({ layer: -1, layerName: 'init', step: 'start', detail: `Input: ${text.length} chars, ${patterns.length} patterns, action=${action}` });
  }

  // ── Layer 2: Regex pattern matching ──
  const regexStart = trace ? performance.now() : 0;
  for (const pattern of patterns) {
    const patStart = trace ? performance.now() : 0;

    // Quick pre-check: if context words don't appear anywhere, skip entirely
    if (pattern.requireContext && !hasContext(text, pattern.requireContext)) {
      if (trace) {
        trace.entries.push({
          layer: 2, layerName: 'regex', step: 'context-skip',
          detail: `[${pattern.name}] context words [${pattern.requireContext.join(', ')}] not found in text — skipped`,
          durationMs: performance.now() - patStart,
        });
      }
      continue;
    }

    let matches: string[];

    if (pattern.requireContext) {
      // For context-dependent patterns, filter matches by nearby context
      const posMatches = runRegexWithPositions(pattern.regex, text, PATTERN_TIMEOUT_MS);
      const filtered = posMatches.filter((m) => hasNearbyContext(text, m.index, m.match.length, pattern.requireContext!));
      matches = filtered.map((m) => m.match);
      if (trace) {
        trace.entries.push({
          layer: 2, layerName: 'regex', step: 'context-match',
          detail: `[${pattern.name}] regex matched ${posMatches.length}, ${filtered.length} with nearby context [${pattern.requireContext.join(', ')}]`,
          durationMs: performance.now() - patStart,
        });
      }
    } else {
      matches = runRegexWithTimeout(pattern.regex, text, PATTERN_TIMEOUT_MS);
      if (trace) {
        trace.entries.push({
          layer: 2, layerName: 'regex', step: 'match',
          detail: `[${pattern.name}] (${pattern.category}) regex /${pattern.regex.source}/ → ${matches.length} match(es)${matches.length > 0 ? ': ' + matches.map(m => m.length > 40 ? m.slice(0, 40) + '...' : m).join(', ') : ''}`,
          durationMs: performance.now() - patStart,
        });
      }
    }

    if (matches.length === 0) continue;

    // Run validator if one is specified
    const validatedMatches = pattern.validator
      ? matches.filter((m) => validators[pattern.validator!]?.(m) ?? true)
      : matches;

    if (trace && pattern.validator) {
      const rejected = matches.length - validatedMatches.length;
      trace.entries.push({
        layer: 2, layerName: 'regex', step: 'validate',
        detail: `[${pattern.name}] validator "${pattern.validator}": ${validatedMatches.length} passed, ${rejected} rejected`,
      });
    }

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

  if (trace) {
    trace.entries.push({
      layer: 2, layerName: 'regex', step: 'summary',
      detail: `Layer 2 complete: ${findings.length} finding(s) from regex patterns`,
      durationMs: performance.now() - regexStart,
    });
  }

  // ── Layer 0 + 1 + 3: Structure → Entropy → Semantic detection ──
  // Detect generic secrets: high-entropy values in sensitive field names
  // that were NOT already caught by a specific regex pattern above.
  const structStart = trace ? performance.now() : 0;
  const fields = extractStructuredFields(text);

  if (trace) {
    trace.entries.push({
      layer: 0, layerName: 'structure', step: 'extract',
      detail: `Layer 0: extracted ${fields.length} field(s) from text${fields.length > 0 ? ' — ' + fields.map(f => `${f.path}=${f.value.length > 20 ? f.value.slice(0, 20) + '...' : f.value}`).join('; ') : ''}`,
      durationMs: performance.now() - structStart,
    });
  }

  for (const field of fields) {
    if (field.value.length < MIN_ENTROPY_LENGTH || field.value.length > MAX_SECRET_LENGTH) {
      if (trace) {
        trace.entries.push({
          layer: 1, layerName: 'entropy', step: 'length-skip',
          detail: `[${field.path}] value length ${field.value.length} outside range [${MIN_ENTROPY_LENGTH}, ${MAX_SECRET_LENGTH}] — skipped`,
        });
      }
      continue;
    }

    const sensitive = isSensitiveFieldName(field.key);
    if (!sensitive) {
      if (trace) {
        trace.entries.push({
          layer: 3, layerName: 'semantics', step: 'not-sensitive',
          detail: `[${field.path}] field name "${field.key}" not sensitive — skipped`,
        });
      }
      continue;
    }

    const entropy = shannonEntropy(field.value);
    const highEnt = entropy >= DEFAULT_ENTROPY_THRESHOLD;
    if (trace) {
      trace.entries.push({
        layer: 1, layerName: 'entropy', step: highEnt ? 'high' : 'low',
        detail: `[${field.path}] entropy=${entropy.toFixed(3)} bits/char (threshold=${DEFAULT_ENTROPY_THRESHOLD})${highEnt ? ' → HIGH' : ' → low, skipped'}`,
      });
    }
    if (!highEnt) continue;

    // Check if this value is already covered by a regex finding
    const alreadyCovered = findings.some((f) =>
      f.matches.some((m) => field.value.includes(m) || m.includes(field.value)),
    );
    if (alreadyCovered) {
      if (trace) {
        trace.entries.push({
          layer: 1, layerName: 'entropy', step: 'dedup',
          detail: `[${field.path}] already covered by regex finding — skipped`,
        });
      }
      continue;
    }

    if (trace) {
      trace.entries.push({
        layer: 1, layerName: 'entropy', step: 'finding',
        detail: `[${field.path}] ✓ generic-secret detected: sensitive field "${field.key}" + high entropy (${entropy.toFixed(3)})`,
      });
    }

    findings.push({
      patternName: 'generic-secret',
      patternCategory: 'entropy',
      matchCount: 1,
      matches: [field.value],
    });

    if (action === 'redact') {
      redactedBody = redactedBody.replaceAll(field.value, '[GENERIC-SECRET_REDACTED]');
      // Also handle JSON-encoded version (escapes like \" or \\n)
      const encoded = JSON.stringify(field.value).slice(1, -1);
      if (encoded !== field.value) {
        redactedBody = redactedBody.replaceAll(encoded, '[GENERIC-SECRET_REDACTED]');
      }
    }
  }

  if (trace) {
    trace.totalDurationMs = performance.now() - t0;
    trace.entries.push({
      layer: -1, layerName: 'summary', step: 'done',
      detail: `Scan complete: ${findings.length} total finding(s), action=${findings.length === 0 ? 'pass' : action}, ${trace.totalDurationMs.toFixed(2)}ms`,
      durationMs: trace.totalDurationMs,
    });
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
