/**
 * Layer 3: Field-name Semantics
 *
 * Uses JSON field names to identify potentially sensitive data.
 * When a value appears under a field like "api_key" or "password",
 * it provides strong signal that the value is a secret — even if
 * no specific regex pattern matches.
 *
 * Built-in patterns are immutable defaults.
 * Additional patterns / non-sensitive names can be added at runtime
 * via updateSemanticConfig() (driven by the Settings UI).
 */

// ── Built-in defaults (immutable) ──

/** Patterns that indicate a field likely holds a secret */
const BUILTIN_SENSITIVE: RegExp[] = [
  /passw(?:or)?d/i,
  /(?:^|[_-]|\b)secret/i,
  /(?:^|[_-]|\b)token(?:$|[_-]|\b)/i,
  /api[_-]?key/i,
  /(?:^|[_-]|\b)auth(?:$|[_-])/i,
  /credential/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /secret[_-]?key/i,
  /(?:^|[_-]|\b)cipher(?:$|[_-]|\b)/i,
  /(?:^|[_-]|\b)salt(?:$|[_-]|\b)/i,
  /connection[_-]?string/i,
  /(?:^|[_-]|\b)dsn(?:$|[_-]|\b)/i,
  /(?:^|[_-]|\b)signing/i,
  /(?:^|[_-]|\b)bearer(?:$|[_-]|\b)/i,
  /(?:^|[_-]|\b)authorization(?:$|[_-]|\b)/i,
];

/** Known non-sensitive field names (fast reject to avoid false positives) */
const BUILTIN_NON_SENSITIVE = new Set([
  'role', 'model', 'content', 'type', 'name', 'id', 'version',
  'method', 'path', 'url', 'status', 'message', 'description',
  'format', 'language', 'encoding', 'timestamp', 'created',
  'max_tokens', 'temperature', 'top_p', 'stream', 'stop',
  'n', 'presence_penalty', 'frequency_penalty', 'text',
  'index', 'object', 'finish_reason', 'logprobs', 'usage',
  'prompt_tokens', 'completion_tokens', 'total_tokens',
  'system_fingerprint', 'created_at', 'updated_at', 'choices',
  'response_format', 'seed', 'tool_choice', 'function_call',
  'safety_ratings', 'candidates',
]);

// ── User-configurable extras (mutable at runtime) ──

let extraSensitive: RegExp[] = [];
let extraNonSensitive: Set<string> = new Set();

export interface SemanticConfig {
  /** Additional regex patterns (strings) for sensitive field names */
  sensitivePatterns?: string[];
  /** Additional non-sensitive field names to exclude */
  nonSensitiveNames?: string[];
}

/** Update user-configurable semantic rules. Called when config changes. */
export function updateSemanticConfig(config: SemanticConfig): void {
  extraSensitive = (config.sensitivePatterns ?? [])
    .filter(p => p.length > 0)
    .map(p => {
      try { return new RegExp(p, 'i'); }
      catch { return null; }
    })
    .filter((r): r is RegExp => r !== null);

  extraNonSensitive = new Set(
    (config.nonSensitiveNames ?? []).map(n => n.toLowerCase()),
  );
}

/** Read-only access to built-in sensitive patterns (for UI display) */
export function getBuiltinSensitivePatterns(): string[] {
  return BUILTIN_SENSITIVE.map(r => r.source);
}

/** Read-only access to built-in non-sensitive names (for UI display) */
export function getBuiltinNonSensitiveNames(): string[] {
  return [...BUILTIN_NON_SENSITIVE];
}

/** Check if a field name suggests it holds sensitive data */
export function isSensitiveFieldName(name: string): boolean {
  const lower = name.toLowerCase();

  // Non-sensitive fast reject (built-in + user extras)
  if (BUILTIN_NON_SENSITIVE.has(lower)) return false;
  if (extraNonSensitive.has(lower)) return false;

  // Sensitive check (built-in + user extras)
  if (BUILTIN_SENSITIVE.some(re => re.test(name))) return true;
  if (extraSensitive.some(re => re.test(name))) return true;

  return false;
}
