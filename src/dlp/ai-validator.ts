import https from 'node:https';
import { createLogger } from '../utils/logger.js';
import type { DlpFinding } from './actions.js';

const log = createLogger('ai-validator');

const SNIPPET_RADIUS = 200;

export interface AiValidatorConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  timeoutMs: number;
  cacheSize: number;
}

interface CacheEntry {
  verdict: 'sensitive' | 'false_positive';
  reason: string;
}

// ── Simple LRU cache ──

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: CacheEntry): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

// ── AI Validator ──

export class AiValidator {
  private config: AiValidatorConfig;
  private cache: LRUCache;

  constructor(config: AiValidatorConfig) {
    this.config = config;
    this.cache = new LRUCache(config.cacheSize);
  }

  /** Returns true if the validator is ready (enabled + apiKey configured) */
  get ready(): boolean {
    return this.config.enabled && this.config.apiKey.length > 0;
  }

  /** Update config at runtime (e.g. toggle enabled) */
  updateConfig(config: Partial<AiValidatorConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Filter findings through AI validation.
   * Returns only findings that the AI confirms as real sensitive data.
   */
  async validate(findings: DlpFinding[], text: string): Promise<DlpFinding[]> {
    if (!this.ready || findings.length === 0) return findings;

    const confirmed: DlpFinding[] = [];

    for (const finding of findings) {
      const firstMatch = finding.matches[0] ?? '';
      const cacheKey = `${finding.patternName}:${firstMatch}`;

      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached) {
        if (cached.verdict === 'sensitive') {
          confirmed.push(finding);
        } else {
          log.debug('AI cache: false positive', { pattern: finding.patternName, reason: cached.reason });
        }
        continue;
      }

      // Extract surrounding context
      const context = extractContext(text, firstMatch, SNIPPET_RADIUS);

      try {
        const result = await this.callLLM(finding, firstMatch, context);
        this.cache.set(cacheKey, result);

        if (result.verdict === 'sensitive') {
          confirmed.push(finding);
        } else {
          log.info('AI validator: false positive filtered', {
            pattern: finding.patternName,
            reason: result.reason,
          });
        }
      } catch (err) {
        // On error, fail-closed: treat as real sensitive data
        log.warn('AI validation failed, treating as sensitive', {
          pattern: finding.patternName,
          error: (err as Error).message,
        });
        confirmed.push(finding);
      }
    }

    return confirmed;
  }

  private async callLLM(
    finding: DlpFinding,
    matchText: string,
    context: string,
  ): Promise<CacheEntry> {
    const prompt = buildPrompt(finding, matchText, context);

    if (this.config.provider === 'anthropic') {
      return this.callAnthropic(prompt);
    }
    return this.callOpenAI(prompt);
  }

  private callAnthropic(prompt: string): Promise<CacheEntry> {
    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    return this.httpPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    ).then((raw) => {
      const res = JSON.parse(raw);
      const text = res.content?.[0]?.text ?? '';
      return parseVerdict(text);
    });
  }

  private callOpenAI(prompt: string): Promise<CacheEntry> {
    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: 150,
      messages: [
        { role: 'system', content: 'You are a security data classifier. Respond ONLY with the JSON format requested.' },
        { role: 'user', content: prompt },
      ],
    });

    return this.httpPost(
      'api.openai.com',
      '/v1/chat/completions',
      {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.config.apiKey}`,
      },
      body,
    ).then((raw) => {
      const res = JSON.parse(raw);
      const text = res.choices?.[0]?.message?.content ?? '';
      return parseVerdict(text);
    });
  }

  private httpPost(
    hostname: string,
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { hostname, path, method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const result = Buffer.concat(chunks).toString('utf-8');
            if (status >= 200 && status < 300) {
              resolve(result);
            } else {
              reject(new Error(`HTTP ${status}: ${result.slice(0, 200)}`));
            }
          });
        },
      );

      req.setTimeout(this.config.timeoutMs, () => {
        req.destroy(new Error(`AI validation timed out (${this.config.timeoutMs}ms)`));
      });

      req.on('error', reject);
      req.end(body);
    });
  }
}

// ── Helpers ──

function extractContext(text: string, match: string, radius: number): string {
  const idx = text.indexOf(match);
  if (idx === -1) return match;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + match.length + radius);
  return text.slice(start, end);
}

function buildPrompt(finding: DlpFinding, matchText: string, context: string): string {
  // Mask part of the match to avoid leaking secrets through the AI API
  const masked = matchText.length > 8
    ? matchText.slice(0, 4) + '*'.repeat(matchText.length - 8) + matchText.slice(-4)
    : matchText;

  return `You are a security data classifier. Determine if the following regex match is REAL sensitive data or a FALSE POSITIVE (e.g. example/placeholder/test data, documentation, code variable names, or random string that happens to match the pattern).

Pattern: ${finding.patternName} (${finding.patternCategory})
Matched text (partially masked): ${masked}
Surrounding context:
---
${context.slice(0, 500)}
---

Respond with ONLY a JSON object, no other text:
{"verdict": "sensitive" or "false_positive", "reason": "brief one-line explanation"}`;
}

function parseVerdict(text: string): CacheEntry {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const verdict = parsed.verdict === 'false_positive' ? 'false_positive' : 'sensitive';
      return { verdict, reason: parsed.reason ?? '' };
    } catch { /* fall through */ }
  }

  // Fallback: look for keywords
  const lower = text.toLowerCase();
  if (lower.includes('false_positive') || lower.includes('false positive')) {
    return { verdict: 'false_positive', reason: text.slice(0, 100) };
  }
  // Default: treat as sensitive (fail-closed)
  return { verdict: 'sensitive', reason: text.slice(0, 100) };
}
