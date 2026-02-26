import { describe, it, expect } from 'vitest';
import {
  extractToolCallsFromJSON,
  extractToolCallsFromSSE,
  extractToolCalls,
  extractToolCallsFromParsedEvents,
} from '../../../src/tool-guard/extractor.js';

describe('extractToolCallsFromJSON', () => {
  it('extracts Anthropic tool_use blocks', () => {
    const body = JSON.stringify({
      id: 'msg_123',
      type: 'message',
      content: [
        { type: 'text', text: 'Let me run that command.' },
        { type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'ls -la' } },
        { type: 'tool_use', id: 'tu_2', name: 'read_file', input: { path: '/etc/passwd' } },
      ],
    });
    const calls = extractToolCallsFromJSON(body);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe('bash');
    expect(calls[0].toolInput).toEqual({ command: 'ls -la' });
    expect(calls[0].provider).toBe('anthropic');
    expect(calls[1].toolName).toBe('read_file');
  });

  it('extracts OpenAI function tool_calls', () => {
    const body = JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
          ],
        },
      }],
    });
    const calls = extractToolCallsFromJSON(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('get_weather');
    expect(calls[0].toolInput).toEqual({ city: 'NYC' });
    expect(calls[0].provider).toBe('openai');
  });

  it('extracts Gemini functionCall from candidates', () => {
    const body = JSON.stringify({
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: 'get_weather', args: { city: 'Tokyo' } } },
            { functionCall: { name: 'get_time', args: { timezone: 'JST' } } },
          ],
          role: 'model',
        },
      }],
    });
    const calls = extractToolCallsFromJSON(body);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe('get_weather');
    expect(calls[0].toolInput).toEqual({ city: 'Tokyo' });
    expect(calls[0].provider).toBe('gemini');
    expect(calls[1].toolName).toBe('get_time');
  });

  it('returns empty for Gemini response without functionCall', () => {
    const body = JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: 'Hello!' }],
          role: 'model',
        },
      }],
    });
    expect(extractToolCallsFromJSON(body)).toHaveLength(0);
  });

  it('returns empty for responses without tool calls', () => {
    const body = JSON.stringify({
      content: [{ type: 'text', text: 'Hello!' }],
    });
    expect(extractToolCallsFromJSON(body)).toHaveLength(0);
  });

  it('returns empty for invalid JSON', () => {
    expect(extractToolCallsFromJSON('not json')).toHaveLength(0);
  });
});

describe('extractToolCallsFromSSE', () => {
  it('extracts Anthropic SSE tool calls', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-20250514"}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"bash"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"com"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"mand\\":\\"rm -rf /\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      '',
    ].join('\n');

    const calls = extractToolCallsFromSSE(sse);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('bash');
    expect(calls[0].toolInput).toEqual({ command: 'rm -rf /' });
    expect(calls[0].provider).toBe('anthropic');
  });

  it('extracts OpenAI SSE tool calls', () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather","arguments":""}}]}}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city"}}]}}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\": \\"NYC\\"}"}}]}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const calls = extractToolCallsFromSSE(sse);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('get_weather');
    expect(calls[0].toolInput).toEqual({ city: 'NYC' });
    expect(calls[0].provider).toBe('openai');
  });

  it('handles multiple Anthropic tool calls in one stream', () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      '',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"bash"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"cmd\\":\\"ls\\"}"}}',
      '',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_2","name":"write_file"}}',
      '',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"/tmp/x\\"}"}}',
      '',
      'data: {"type":"content_block_stop","index":1}',
      '',
    ].join('\n');

    const calls = extractToolCallsFromSSE(sse);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe('bash');
    expect(calls[1].toolName).toBe('write_file');
  });

  it('extracts Gemini SSE tool calls', () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"bash","args":{"command":"rm -rf /"}}}],"role":"model"}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"/etc/passwd"}}}],"role":"model"}}]}',
      '',
    ].join('\n');

    const calls = extractToolCallsFromSSE(sse);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe('bash');
    expect(calls[0].toolInput).toEqual({ command: 'rm -rf /' });
    expect(calls[0].provider).toBe('gemini');
    expect(calls[1].toolName).toBe('read_file');
  });

  it('extracts OpenAI Responses API SSE tool calls', () => {
    const sse = [
      'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","name":"bash","call_id":"call_1"}}',
      '',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"com"}',
      '',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"mand\\":\\"rm -rf /\\"}"}',
      '',
      'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":0,"name":"bash","arguments":"{\\"command\\":\\"rm -rf /\\"}"}',
      '',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","name":"bash","arguments":"{\\"command\\":\\"rm -rf /\\"}"}}',
      '',
    ].join('\n');

    const calls = extractToolCallsFromSSE(sse);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('bash');
    expect(calls[0].toolInput).toEqual({ command: 'rm -rf /' });
    expect(calls[0].provider).toBe('openai');
  });

  it('extracts OpenAI Responses API tool calls from pre-parsed events', () => {
    const events = [
      { type: 'response.created', response: { id: 'resp_1' } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'bash', call_id: 'call_1' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"command":' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"ls -la"}' },
      { type: 'response.function_call_arguments.done', item_id: 'fc_1', name: 'bash', arguments: '{"command":"ls -la"}' },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', name: 'bash', arguments: '{"command":"ls -la"}' } },
      { type: 'response.done', response: { id: 'resp_1' } },
    ];

    const calls = extractToolCallsFromParsedEvents(events as Record<string, unknown>[]);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('bash');
    expect(calls[0].toolInput).toEqual({ command: 'ls -la' });
    expect(calls[0].provider).toBe('openai');
  });

  it('returns empty for non-tool SSE', () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      '',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}',
      '',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ].join('\n');
    expect(extractToolCallsFromSSE(sse)).toHaveLength(0);
  });
});

describe('extractToolCalls (auto-detect)', () => {
  it('uses JSON extraction for non-streaming', () => {
    const body = JSON.stringify({
      content: [{ type: 'tool_use', name: 'bash', input: { command: 'echo hi' } }],
    });
    const calls = extractToolCalls(body, false);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('bash');
  });

  it('uses SSE extraction for streaming', () => {
    const sse = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"bash"}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\":1}"}}',
      '',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ].join('\n');
    const calls = extractToolCalls(sse, true);
    expect(calls).toHaveLength(1);
  });

  it('auto-detects SSE even when isStreaming is false', () => {
    const sse = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"test"}}\n\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\ndata: {"type":"content_block_stop","index":0}\n\n';
    const calls = extractToolCalls(sse, false);
    expect(calls).toHaveLength(1);
  });
});
