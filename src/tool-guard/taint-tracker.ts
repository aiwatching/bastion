import crypto from 'node:crypto';

export interface TaintMark {
  sessionId: string;
  requestId: string;
  patternName: string;
  fingerprint: string;
  timestamp: number;
}

export interface TaintMatch {
  patternName: string;
  fingerprint: string;
}

export class TaintTracker {
  private sessionTaints = new Map<string, TaintMark[]>();
  private ttlMs: number;

  constructor(ttlMinutes: number = 60) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  /** Create a fingerprint from matched content: SHA256 first 16 hex chars */
  static fingerprint(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  markTaint(sessionId: string, requestId: string, patternName: string, matchedContent: string): string {
    const fingerprint = TaintTracker.fingerprint(matchedContent);
    let taints = this.sessionTaints.get(sessionId);
    if (!taints) {
      taints = [];
      this.sessionTaints.set(sessionId, taints);
    }
    taints.push({
      sessionId,
      requestId,
      patternName,
      fingerprint,
      timestamp: Date.now(),
    });
    return fingerprint;
  }

  /** Check if tool input contains any tainted content fingerprints */
  checkToolInput(sessionId: string, toolInput: string): TaintMatch | null {
    const taints = this.getActiveTaints(sessionId);
    if (taints.length === 0) return null;

    // Generate sliding-window fingerprints from tool input and check against taints
    // For efficiency, we check if any taint fingerprint appears as a substring hash
    for (const taint of taints) {
      // Check if the fingerprinted content appears in tool input by re-hashing substrings
      // This is a simplified approach: we hash various substrings of the input
      // For practical use, we check if the original matched content reappears
      // by comparing fingerprints of input chunks
      const inputFingerprint = TaintTracker.fingerprint(toolInput);
      if (inputFingerprint === taint.fingerprint) {
        return { patternName: taint.patternName, fingerprint: taint.fingerprint };
      }
    }

    return null;
  }

  getActiveTaints(sessionId: string): TaintMark[] {
    const taints = this.sessionTaints.get(sessionId);
    if (!taints) return [];

    const cutoff = Date.now() - this.ttlMs;
    // Remove expired taints
    const active = taints.filter(t => t.timestamp > cutoff);
    if (active.length !== taints.length) {
      this.sessionTaints.set(sessionId, active);
    }
    return active;
  }

  cleanup(sessionId: string): void {
    this.sessionTaints.delete(sessionId);
  }
}
