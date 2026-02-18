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
  redactedBody?: string;
}
