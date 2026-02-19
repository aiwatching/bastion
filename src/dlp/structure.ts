/**
 * Layer 0: Structure-aware Parsing
 *
 * Extracts key-value fields from JSON request/response bodies.
 * Provides structural context for downstream layers:
 * - Field names help identify sensitive data by semantic meaning
 * - Extracted values can be individually analyzed for entropy
 *
 * Also extracts inline assignments (KEY=value) from text content,
 * catching secrets embedded in message strings.
 */

export interface StructuredField {
  /** Immediate field name (e.g., "api_key") */
  key: string;
  /** Full JSON path (e.g., "credentials.api_key") */
  path: string;
  /** The string value */
  value: string;
}

/** Maximum text size for structural analysis (skip for very large bodies) */
const MAX_TEXT_LENGTH = 512 * 1024;

/**
 * Extract string fields from a JSON text body.
 * Returns empty array if text is not valid JSON or exceeds size limit.
 */
export function extractStructuredFields(text: string): StructuredField[] {
  if (text.length > MAX_TEXT_LENGTH) return [];

  const fields: StructuredField[] = [];

  try {
    const parsed = JSON.parse(text);
    walkJson(parsed, '', fields);
  } catch {
    // Not JSON — extract assignment patterns as fallback
    extractAssignments(text, fields);
  }

  return fields;
}

/** Recursively walk JSON and collect string values with their paths */
function walkJson(obj: unknown, path: string, out: StructuredField[]): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    const key = extractKey(path);
    if (obj.length >= 6) {
      out.push({ key, path, value: obj });
    }
    // Also scan long string content for inline assignments
    if (obj.length > 20) {
      extractAssignments(obj, out);
    }
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      walkJson(obj[i], `${path}[${i}]`, out);
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      walkJson(v, path ? `${path}.${k}` : k, out);
    }
  }
}

/** Extract the immediate key name from a JSON path */
function extractKey(path: string): string {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  return last.replace(/\[\d+\]$/, '');
}

/** Extract KEY=VALUE and KEY: VALUE assignment patterns from text */
const ASSIGN_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*['"]?([^\s'"=;,}{)]{8,})/g;

function extractAssignments(text: string, out: StructuredField[]): void {
  const re = new RegExp(ASSIGN_RE.source, ASSIGN_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ key: m[1], path: m[1], value: m[2] });
  }
}
