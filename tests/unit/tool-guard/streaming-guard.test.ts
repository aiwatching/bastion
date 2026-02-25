import { describe, it, expect, vi } from 'vitest';
import { StreamingToolGuard } from '../../../src/tool-guard/streaming-guard.js';

function makeSSE(eventType: string, data: Record<string, unknown>): { raw: string; parsed: Record<string, unknown> } {
  const parsed = data;
  const raw = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  return { raw, parsed };
}

describe('StreamingToolGuard', () => {
  it('forwards non-tool events immediately', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    const msg = makeSSE('message_start', { type: 'message_start', message: { role: 'assistant' } });
    guard.processEvent(msg.raw, msg.parsed);

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toContain('message_start');
  });

  it('forwards text content blocks immediately', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    const start = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    const delta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    });
    const stop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 0 });

    guard.processEvent(start.raw, start.parsed);
    guard.processEvent(delta.raw, delta.parsed);
    guard.processEvent(stop.raw, stop.parsed);

    expect(forwarded).toHaveLength(3);
  });

  it('buffers tool_use blocks and flushes safe ones', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    const start = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' },
    });
    const delta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"path":"/src/main.ts"}' },
    });
    const stop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 1 });

    guard.processEvent(start.raw, start.parsed);
    expect(forwarded).toHaveLength(0); // buffered, not forwarded yet

    guard.processEvent(delta.raw, delta.parsed);
    expect(forwarded).toHaveLength(0); // still buffered

    guard.processEvent(stop.raw, stop.parsed);
    // Safe tool call — all 3 buffered events flushed
    expect(forwarded).toHaveLength(3);
    expect(forwarded[0]).toContain('content_block_start');
    expect(forwarded[1]).toContain('input_json_delta');
    expect(forwarded[2]).toContain('content_block_stop');
  });

  it('blocks dangerous tool_use and replaces with text warning', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    const start = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash' },
    });
    // Build JSON input in chunks: {"command":"rm -rf /"}
    const delta1 = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"rm -rf /' },
    });
    const delta2 = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"}' },
    });
    const stop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 0 });

    guard.processEvent(start.raw, start.parsed);
    guard.processEvent(delta1.raw, delta1.parsed);
    guard.processEvent(delta2.raw, delta2.parsed);
    guard.processEvent(stop.raw, stop.parsed);

    // Should have replaced with 3 text block events
    expect(forwarded).toHaveLength(3);
    expect(forwarded[0]).toContain('"type":"text"');
    expect(forwarded[1]).toContain('BLOCKED by Bastion Tool Guard');
    expect(forwarded[1]).toContain('bash');
    expect(forwarded[2]).toContain('content_block_stop');

    // Results should record the block
    expect(guard.results).toHaveLength(1);
    expect(guard.results[0].toolName).toBe('bash');
    expect(guard.results[0].blocked).toBe(true);
  });

  it('respects blockMinSeverity threshold — high severity not blocked at critical threshold', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    // git push --force is "high" severity, threshold is "critical" — should NOT block
    const start = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash' },
    });
    const delta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"git push --force origin main"}' },
    });
    const stop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 0 });

    guard.processEvent(start.raw, start.parsed);
    guard.processEvent(delta.raw, delta.parsed);
    guard.processEvent(stop.raw, stop.parsed);

    // Should flush original events (not blocked)
    expect(forwarded).toHaveLength(3);
    expect(forwarded[0]).toContain('tool_use');
    // Rule matched but not blocked
    expect(guard.results).toHaveLength(1);
    expect(guard.results[0].blocked).toBe(false);
  });

  it('blocks high severity when threshold is high', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'high' },
      (data) => forwarded.push(data),
    );

    const start = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash' },
    });
    const delta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"git push --force origin main"}' },
    });
    const stop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 0 });

    guard.processEvent(start.raw, start.parsed);
    guard.processEvent(delta.raw, delta.parsed);
    guard.processEvent(stop.raw, stop.parsed);

    // Should be replaced with text warning
    expect(forwarded).toHaveLength(3);
    expect(forwarded[1]).toContain('BLOCKED by Bastion Tool Guard');
    expect(guard.results[0].blocked).toBe(true);
  });

  it('handles interleaved text and tool blocks correctly', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    // Text block at index 0 — forwarded immediately
    const textStart = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    const textDelta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Let me help' },
    });
    const textStop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 0 });

    // Tool block at index 1 — buffered then flushed (safe)
    const toolStart = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' },
    });
    const toolDelta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"path":"foo.ts"}' },
    });
    const toolStop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 1 });

    guard.processEvent(textStart.raw, textStart.parsed);
    guard.processEvent(textDelta.raw, textDelta.parsed);
    guard.processEvent(textStop.raw, textStop.parsed);
    expect(forwarded).toHaveLength(3); // text forwarded immediately

    guard.processEvent(toolStart.raw, toolStart.parsed);
    guard.processEvent(toolDelta.raw, toolDelta.parsed);
    expect(forwarded).toHaveLength(3); // tool still buffered

    guard.processEvent(toolStop.raw, toolStop.parsed);
    expect(forwarded).toHaveLength(6); // tool flushed
  });

  it('forwards non-JSON events (like [DONE]) as-is', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    guard.processEvent('data: [DONE]\n\n', null);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toBe('data: [DONE]\n\n');
  });

  it('flush() forwards incomplete buffered events on stream end', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    const start = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash' },
    });
    const delta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"ls' },
    });

    guard.processEvent(start.raw, start.parsed);
    guard.processEvent(delta.raw, delta.parsed);
    expect(forwarded).toHaveLength(0); // still buffered

    // Stream ends unexpectedly — flush should forward as-is
    guard.flush();
    expect(forwarded).toHaveLength(2);
  });

  it('preserves correct index in replacement events', () => {
    const forwarded: string[] = [];
    const guard = new StreamingToolGuard(
      { blockMinSeverity: 'critical' },
      (data) => forwarded.push(data),
    );

    // Tool at index 2 (not 0)
    const start = makeSSE('content_block_start', {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash' },
    });
    const delta = makeSSE('content_block_delta', {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"command":"rm -rf /"}' },
    });
    const stop = makeSSE('content_block_stop', { type: 'content_block_stop', index: 2 });

    guard.processEvent(start.raw, start.parsed);
    guard.processEvent(delta.raw, delta.parsed);
    guard.processEvent(stop.raw, stop.parsed);

    // Replacement events should use index 2
    for (const evt of forwarded) {
      const data = JSON.parse(evt.split('data: ')[1].split('\n')[0]);
      expect(data.index).toBe(2);
    }
  });
});
