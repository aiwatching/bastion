/**
 * Simple token estimation heuristic.
 * Average English text: ~4 characters per token for most models.
 */
export function estimateTokens(text: string): number {
  // Rough heuristic: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}
