/**
 * Message-level DLP cache.
 *
 * LLM API requests carry the full conversation history in a `messages[]` array.
 * Without caching, every turn re-scans ALL previous messages — O(N²) cumulative.
 *
 * This module hashes individual messages and caches their DLP findings so that
 * only new/unseen messages are scanned. Complexity drops to O(N).
 *
 * Cache also distinguishes between "new findings" (first detection) and
 * "cached findings" (repeated from history) so the caller can decide
 * whether to record duplicate DLP events.
 */

import { sha256 } from '../utils/hash.js';
import { scanText, type DlpPattern } from './engine.js';
import type { DlpFinding, DlpResult, DlpAction } from './actions.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('dlp-cache');

// ── LRU Cache ──

class LRUCache<V> {
  private cache = new Map<string, V>();
  constructor(private maxSize: number) {}

  get(key: string): V | undefined {
    const v = this.cache.get(key);
    if (v !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      const first = this.cache.keys().next().value!;
      this.cache.delete(first);
    }
  }

  get size(): number { return this.cache.size; }
  clear(): void { this.cache.clear(); }
}

// ── Message extraction ──

interface Message {
  role?: string;
  content?: unknown;
}

function preview(text: string, maxLen = 60): string {
  const oneLine = text.replace(/\n/g, '\\n');
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + '...' : oneLine;
}

/** Extract the text content of a single message for DLP scanning */
function messageText(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  // Content blocks array (Anthropic multimodal: [{type:"text", text:"..."}, ...])
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: Record<string, unknown>) => typeof b.text === 'string')
      .map((b: Record<string, unknown>) => b.text as string)
      .join('\n');
  }
  return '';
}

/** Compute a stable hash for message content */
function messageHash(msg: Message): string {
  const raw = typeof msg.content === 'string'
    ? msg.content
    : JSON.stringify(msg.content ?? '');
  return sha256(raw);
}

// ── Public API ──

export interface MessageCacheStats {
  hits: number;
  misses: number;
  size: number;
}

/** Per-message scan detail for diagnostics */
interface MessageScanDetail {
  index: number;
  role: string;
  bytes: number;
  source: 'cache' | 'scanned' | 'empty';
  hash: string;
  findings: string[];
  preview: string;
}

export interface CachedDlpResult extends DlpResult {
  /** Findings from newly scanned messages (first-time detection) */
  newFindings: DlpFinding[];
  /** Findings from cache (already detected in a previous request) */
  cachedFindings: DlpFinding[];
}

export class DlpMessageCache {
  private cache: LRUCache<DlpFinding[]>;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 5000) {
    this.cache = new LRUCache(maxSize);
  }

  get stats(): MessageCacheStats {
    return { hits: this.hits, misses: this.misses, size: this.cache.size };
  }

  /**
   * Scan a request body with message-level caching.
   *
   * If parsedBody has a `messages[]` array, each message is individually
   * hashed and checked against the cache. Only new messages are scanned.
   *
   * Falls back to full-body scan for non-messages payloads.
   */
  scanWithCache(
    body: string,
    parsedBody: Record<string, unknown>,
    patterns: DlpPattern[],
    action: DlpAction,
  ): CachedDlpResult {
    const messages = parsedBody.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      // Not a messages-format request — full scan
      const t0 = performance.now();
      const result = scanText(body, patterns, action);
      log.info('DLP scan (full body)', {
        bodyBytes: body.length,
        patterns: patterns.length,
        findings: result.findings.length,
        action: result.action,
        durationMs: +(performance.now() - t0).toFixed(2),
      });
      return { ...result, newFindings: result.findings, cachedFindings: [] };
    }

    const t0 = performance.now();
    const newFindings: DlpFinding[] = [];
    const cachedFindings: DlpFinding[] = [];
    const details: MessageScanDetail[] = [];
    let scannedNew = 0;
    let scannedNewBytes = 0;
    let cacheHit = 0;
    let skippedEmpty = 0;
    let cachedFindingsCount = 0;

    // Scan system prompt (Anthropic format)
    const system = parsedBody.system;
    if (system) {
      const sysText = typeof system === 'string' ? system : JSON.stringify(system);
      const sysHash = sha256(sysText);
      const cached = this.cache.get(sysHash);
      if (cached !== undefined) {
        cachedFindings.push(...cached);
        cachedFindingsCount += cached.length;
        cacheHit++;
        this.hits++;
        details.push({
          index: -1, role: 'system', bytes: sysText.length,
          source: 'cache', hash: sysHash.slice(0, 8),
          findings: cached.map(f => f.patternName),
          preview: preview(sysText),
        });
      } else {
        const result = scanText(sysText, patterns, 'warn');
        this.cache.set(sysHash, result.findings);
        newFindings.push(...result.findings);
        scannedNew++;
        scannedNewBytes += sysText.length;
        this.misses++;
        details.push({
          index: -1, role: 'system', bytes: sysText.length,
          source: 'scanned', hash: sysHash.slice(0, 8),
          findings: result.findings.map(f => f.patternName),
          preview: preview(sysText),
        });
      }
    }

    // Scan each message individually
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as Message;
      const text = messageText(msg);
      const role = msg.role ?? 'unknown';

      if (!text) {
        skippedEmpty++;
        details.push({
          index: i, role, bytes: 0,
          source: 'empty', hash: '-',
          findings: [],
          preview: '(empty)',
        });
        continue;
      }

      const hash = messageHash(msg);
      const cached = this.cache.get(hash);

      if (cached !== undefined) {
        cachedFindings.push(...cached);
        cachedFindingsCount += cached.length;
        cacheHit++;
        this.hits++;
        details.push({
          index: i, role, bytes: text.length,
          source: 'cache', hash: hash.slice(0, 8),
          findings: cached.map(f => f.patternName),
          preview: preview(text),
        });
      } else {
        const result = scanText(text, patterns, 'warn');
        this.cache.set(hash, result.findings);
        newFindings.push(...result.findings);
        scannedNew++;
        scannedNewBytes += text.length;
        this.misses++;
        details.push({
          index: i, role, bytes: text.length,
          source: 'scanned', hash: hash.slice(0, 8),
          findings: result.findings.map(f => f.patternName),
          preview: preview(text),
        });
      }
    }

    const allFindings = [...newFindings, ...cachedFindings];
    const totalMessages = messages.length + (system ? 1 : 0);
    const durationMs = +(performance.now() - t0).toFixed(2);
    const hitRate = totalMessages > 0 ? +((cacheHit / totalMessages) * 100).toFixed(1) : 0;

    // Summary log
    log.info('DLP scan (message cache)', {
      messages: totalMessages,
      cacheHit,
      scannedNew,
      skippedEmpty,
      hitRate: `${hitRate}%`,
      scannedNewBytes,
      bodyBytes: body.length,
      savedBytes: body.length - scannedNewBytes,
      newFindings: newFindings.length,
      cachedFindings: cachedFindingsCount,
      totalFindings: allFindings.length,
      action,
      durationMs,
      cacheTotal: this.cache.size,
      cacheHitsTotal: this.hits,
      cacheMissesTotal: this.misses,
    });

    // Per-message detail log
    for (const d of details) {
      const tag = d.source === 'cache'
        ? (d.findings.length > 0 ? 'HIT+FINDING' : 'HIT')
        : d.source === 'scanned'
          ? (d.findings.length > 0 ? 'SCAN+FINDING' : 'SCAN')
          : 'SKIP';
      log.info(`  msg[${d.index}] ${d.role} ${tag}`, {
        bytes: d.bytes,
        hash: d.hash,
        findings: d.findings.length > 0 ? d.findings : undefined,
        preview: d.preview,
      });
    }

    if (allFindings.length === 0) {
      return { action: 'pass', findings: [], newFindings: [], cachedFindings: [] };
    }

    // Apply redaction on the original body string
    let redactedBody: string | undefined;
    if (action === 'redact') {
      redactedBody = body;
      for (const f of allFindings) {
        for (const m of f.matches) {
          redactedBody = redactedBody.replaceAll(m, `[${f.patternName.toUpperCase()}_REDACTED]`);
        }
      }
    }

    return { action, findings: allFindings, redactedBody, newFindings, cachedFindings };
  }

  /** Clear the cache (for testing or config changes) */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
