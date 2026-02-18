import { describe, it, expect } from 'vitest';
import { trimContent } from '../../../src/optimizer/trimmer.js';

describe('Content Trimmer', () => {
  it('collapses multiple spaces in message content', () => {
    const body = JSON.stringify({
      model: 'test',
      messages: [{ role: 'user', content: 'hello    world   test' }],
    });
    const { trimmed, savedChars } = trimContent(body);
    const parsed = JSON.parse(trimmed);
    expect(parsed.messages[0].content).toBe('hello world test');
    expect(savedChars).toBeGreaterThan(0);
  });

  it('collapses excessive newlines', () => {
    const body = JSON.stringify({
      model: 'test',
      messages: [{ role: 'user', content: 'line1\n\n\n\n\nline2' }],
    });
    const { trimmed } = trimContent(body);
    const parsed = JSON.parse(trimmed);
    expect(parsed.messages[0].content).toBe('line1\n\nline2');
  });

  it('handles content parts array', () => {
    const body = JSON.stringify({
      model: 'test',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello    world' }],
        },
      ],
    });
    const { trimmed } = trimContent(body);
    const parsed = JSON.parse(trimmed);
    expect(parsed.messages[0].content[0].text).toBe('hello world');
  });

  it('returns unchanged body for non-JSON', () => {
    const { trimmed, savedChars } = trimContent('not json');
    expect(trimmed).toBe('not json');
    expect(savedChars).toBe(0);
  });

  it('returns unchanged body with no whitespace to trim', () => {
    const body = JSON.stringify({
      model: 'test',
      messages: [{ role: 'user', content: 'clean text' }],
    });
    const { savedChars } = trimContent(body);
    expect(savedChars).toBe(0);
  });
});
