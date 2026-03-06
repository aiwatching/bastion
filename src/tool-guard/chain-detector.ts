import type { ToolChainRule } from './chain-rules.js';

export interface ToolCallEntry {
  category: string;
  timestamp: number;
}

export interface ToolChainMatch {
  rule: ToolChainRule;
  matchedSequence: string[];
}

const MAX_WINDOW_SIZE = 50;

export class ChainDetector {
  private sessionWindows = new Map<string, ToolCallEntry[]>();
  private maxWindowSize: number;

  constructor(maxWindowSize: number = MAX_WINDOW_SIZE) {
    this.maxWindowSize = maxWindowSize;
  }

  recordToolCall(sessionId: string, category: string): void {
    let window = this.sessionWindows.get(sessionId);
    if (!window) {
      window = [];
      this.sessionWindows.set(sessionId, window);
    }
    window.push({ category, timestamp: Date.now() });
    // Trim to max window size
    if (window.length > this.maxWindowSize) {
      window.splice(0, window.length - this.maxWindowSize);
    }
  }

  checkChains(sessionId: string, rules: ToolChainRule[]): ToolChainMatch | null {
    const window = this.sessionWindows.get(sessionId);
    if (!window || window.length < 2) return null;

    const now = Date.now();

    for (const rule of rules) {
      const windowMs = rule.windowSeconds * 1000;

      // Walk backward through the window looking for the sequence in order
      // The last element of the sequence should be the most recent matching entry
      const seq = rule.sequence;
      let seqIdx = seq.length - 1;
      const matched: string[] = new Array(seq.length);

      for (let i = window.length - 1; i >= 0 && seqIdx >= 0; i--) {
        const entry = window[i];
        if (now - entry.timestamp > windowMs) break; // outside time window
        if (entry.category === seq[seqIdx]) {
          matched[seqIdx] = entry.category;
          seqIdx--;
        }
      }

      if (seqIdx < 0) {
        return { rule, matchedSequence: matched };
      }
    }

    return null;
  }

  cleanup(sessionId: string): void {
    this.sessionWindows.delete(sessionId);
  }
}
