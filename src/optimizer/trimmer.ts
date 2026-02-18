/**
 * Content trimmer: collapse excessive whitespace and newlines.
 * Only modifies whitespace — never changes semantic content.
 */
export function trimContent(body: string): { trimmed: string; savedChars: number } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { trimmed: body, savedChars: 0 };
  }

  const original = body.length;
  trimMessages(parsed);
  const trimmed = JSON.stringify(parsed);

  return { trimmed, savedChars: Math.max(0, original - trimmed.length) };
}

function trimMessages(obj: Record<string, unknown>): void {
  const messages = obj.messages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(messages)) return;

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      msg.content = collapseWhitespace(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as Record<string, unknown>).text === 'string') {
          (part as Record<string, string>).text = collapseWhitespace((part as Record<string, string>).text);
        }
      }
    }
  }
}

function collapseWhitespace(text: string): string {
  // Collapse multiple spaces to single, multiple newlines to double
  const result = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Never produce empty string — API rejects empty content blocks
  return result || text;
}
