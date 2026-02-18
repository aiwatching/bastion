/**
 * Prompt reordering for provider cache optimization.
 * Moves system messages and long static content to the front,
 * maximizing cache prefix hits on subsequent requests.
 *
 * Only applies to Anthropic (which has explicit prompt caching).
 */
export function reorderForCache(body: string, provider: string): string {
  if (provider !== 'anthropic') return body;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }

  // Anthropic already puts system at the top level, and messages are ordered.
  // The main optimization is ensuring cache_control markers are on the right blocks.
  // For MVP, we don't modify ordering — just ensure the structure is cache-friendly.
  // This is a placeholder for more sophisticated reordering logic.
  return JSON.stringify(parsed);
}
