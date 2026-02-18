import { describe, it, expect } from 'vitest';
import { SSEParser, parseSSEData, type SSEEvent } from '../../../src/proxy/streaming.js';

describe('SSEParser', () => {
  it('parses complete SSE events', () => {
    const events: SSEEvent[] = [];
    const parser = new SSEParser((e) => events.push(e));

    parser.feed('event: message_start\ndata: {"type":"message_start"}\n\n');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('message_start');
    expect(events[0].data).toBe('{"type":"message_start"}');
  });

  it('handles chunked data', () => {
    const events: SSEEvent[] = [];
    const parser = new SSEParser((e) => events.push(e));

    parser.feed('event: content_block_delta\n');
    parser.feed('data: {"type":"content_block_delta"}\n');
    parser.feed('\n');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('content_block_delta');
  });

  it('handles multiple events in one chunk', () => {
    const events: SSEEvent[] = [];
    const parser = new SSEParser((e) => events.push(e));

    parser.feed(
      'event: message_start\ndata: {"type":"start"}\n\nevent: content\ndata: {"type":"content"}\n\n',
    );

    expect(events).toHaveLength(2);
  });

  it('handles events without event field', () => {
    const events: SSEEvent[] = [];
    const parser = new SSEParser((e) => events.push(e));

    parser.feed('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBeUndefined();
  });

  it('handles [DONE] marker', () => {
    const events: SSEEvent[] = [];
    const parser = new SSEParser((e) => events.push(e));

    parser.feed('data: [DONE]\n\n');

    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('[DONE]');
    expect(parseSSEData(events[0])).toBeNull();
  });

  it('flushes remaining data', () => {
    const events: SSEEvent[] = [];
    const parser = new SSEParser((e) => events.push(e));

    parser.feed('data: {"final":"data"}');
    expect(events).toHaveLength(0);

    parser.flush();
    expect(events).toHaveLength(1);
  });
});

describe('parseSSEData', () => {
  it('parses valid JSON', () => {
    const result = parseSSEData({ data: '{"key":"value"}' });
    expect(result).toEqual({ key: 'value' });
  });

  it('returns null for [DONE]', () => {
    expect(parseSSEData({ data: '[DONE]' })).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseSSEData({ data: 'not json' })).toBeNull();
  });
});
