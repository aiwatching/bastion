export type DlpAction = 'pass' | 'warn' | 'redact' | 'block';

export interface DlpFinding {
  patternName: string;
  patternCategory: string;
  matchCount: number;
  matches: string[];
}

export interface DlpResult {
  action: DlpAction;
  findings: DlpFinding[];
  /** Matches where regex hit but confirmPatterns failed — deferred to L4 AI Validation */
  deferredFindings: DlpFinding[];
  redactedBody?: string;
}
