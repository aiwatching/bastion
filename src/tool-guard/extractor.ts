export interface ExtractedToolCall {
  toolName: string;
  toolInput: Record<string, unknown> | string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'unknown';
}

// ---------- Buffered JSON extraction ----------

function extractAnthropicJSON(body: Record<string, unknown>): ExtractedToolCall[] {
  const content = body.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: Record<string, unknown>) => b?.type === 'tool_use')
    .map((b: Record<string, unknown>) => ({
      toolName: (b.name as string) ?? 'unknown',
      toolInput: (b.input as Record<string, unknown>) ?? {},
      provider: 'anthropic' as const,
    }));
}

function extractOpenAIJSON(body: Record<string, unknown>): ExtractedToolCall[] {
  const choices = body.choices;
  if (!Array.isArray(choices)) return [];
  const results: ExtractedToolCall[] = [];
  for (const choice of choices) {
    const msg = (choice as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const toolCalls = msg.tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const tc of toolCalls) {
      const fn = (tc as Record<string, unknown>).function as Record<string, unknown> | undefined;
      if (!fn) continue;
      let input: Record<string, unknown> | string = {};
      try {
        input = JSON.parse((fn.arguments as string) ?? '{}');
      } catch {
        input = (fn.arguments as string) ?? '';
      }
      results.push({
        toolName: (fn.name as string) ?? 'unknown',
        toolInput: input,
        provider: 'openai' as const,
      });
    }
  }
  return results;
}

function extractGeminiJSON(body: Record<string, unknown>): ExtractedToolCall[] {
  const candidates = body.candidates;
  if (!Array.isArray(candidates)) return [];
  const results: ExtractedToolCall[] = [];
  for (const candidate of candidates) {
    const content = (candidate as Record<string, unknown>).content as Record<string, unknown> | undefined;
    if (!content) continue;
    const parts = content.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const fc = (part as Record<string, unknown>).functionCall as Record<string, unknown> | undefined;
      if (!fc) continue;
      results.push({
        toolName: (fc.name as string) ?? 'unknown',
        toolInput: (fc.args as Record<string, unknown>) ?? {},
        provider: 'gemini' as const,
      });
    }
  }
  return results;
}

export function extractToolCallsFromJSON(body: string): ExtractedToolCall[] {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;

    // Anthropic format: content[].type === 'tool_use'
    if (Array.isArray(parsed.content)) {
      const results = extractAnthropicJSON(parsed);
      if (results.length > 0) return results;
    }

    // OpenAI format: choices[].message.tool_calls[]
    if (Array.isArray(parsed.choices)) {
      const results = extractOpenAIJSON(parsed);
      if (results.length > 0) return results;
    }

    // Gemini format: candidates[].content.parts[].functionCall
    if (Array.isArray(parsed.candidates)) {
      const results = extractGeminiJSON(parsed);
      if (results.length > 0) return results;
    }

    return [];
  } catch {
    return [];
  }
}

// ---------- SSE extraction ----------

function parseSSEEvents(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const lines = text.split('\n');
  const curData: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      curData.push(line.slice(6));
    } else if (line.trim() === '' && curData.length > 0) {
      const raw = curData.join('\n');
      curData.length = 0;
      if (raw !== '[DONE]') {
        try { events.push(JSON.parse(raw)); } catch { /* skip */ }
      }
    }
  }
  if (curData.length > 0) {
    const raw = curData.join('\n');
    if (raw !== '[DONE]') {
      try { events.push(JSON.parse(raw)); } catch { /* skip */ }
    }
  }
  return events;
}

function extractAnthropicSSE(events: Record<string, unknown>[]): ExtractedToolCall[] {
  const results: ExtractedToolCall[] = [];
  let curToolName = '';
  let curToolInput = '';

  for (const d of events) {
    if (d.type === 'content_block_start') {
      const cb = d.content_block as Record<string, unknown> | undefined;
      if (cb?.type === 'tool_use') {
        curToolName = (cb.name as string) ?? '';
        curToolInput = '';
      }
    }
    if (d.type === 'content_block_delta') {
      const delta = d.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'input_json_delta') {
        curToolInput += (delta.partial_json as string) ?? '';
      }
    }
    if (d.type === 'content_block_stop') {
      if (curToolName) {
        let input: Record<string, unknown> | string = curToolInput;
        try { input = JSON.parse(curToolInput); } catch { /* keep as string */ }
        results.push({ toolName: curToolName, toolInput: input, provider: 'anthropic' });
        curToolName = '';
        curToolInput = '';
      }
    }
  }
  return results;
}

function extractOpenAISSE(events: Record<string, unknown>[]): ExtractedToolCall[] {
  // OpenAI streams tool calls as: choices[].delta.tool_calls[].function.{name,arguments}
  // We need to accumulate name + arguments across chunks, keyed by tool call index
  const toolMap = new Map<number, { name: string; args: string }>();

  for (const d of events) {
    const choices = d.choices as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(choices)) continue;
    for (const choice of choices) {
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) continue;
      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(toolCalls)) continue;
      for (const tc of toolCalls) {
        const idx = (tc.index as number) ?? 0;
        if (!toolMap.has(idx)) toolMap.set(idx, { name: '', args: '' });
        const entry = toolMap.get(idx)!;
        const fn = tc.function as Record<string, unknown> | undefined;
        if (fn?.name) entry.name += fn.name as string;
        if (fn?.arguments) entry.args += fn.arguments as string;
      }
    }
  }

  const results: ExtractedToolCall[] = [];
  for (const [, entry] of toolMap) {
    if (!entry.name) continue;
    let input: Record<string, unknown> | string = entry.args;
    try { input = JSON.parse(entry.args); } catch { /* keep as string */ }
    results.push({ toolName: entry.name, toolInput: input, provider: 'openai' });
  }
  return results;
}

/**
 * OpenAI Responses API SSE format (used by chatgpt.com/backend-api/codex/responses):
 *   response.output_item.added  → item.type === 'function_call', item.name
 *   response.function_call_arguments.delta → delta (partial JSON)
 *   response.function_call_arguments.done  → name, arguments (complete)
 *   response.output_item.done   → item with complete function call
 */
function extractOpenAIResponsesSSE(events: Record<string, unknown>[]): ExtractedToolCall[] {
  // Strategy: use .done events as ground truth (they have complete name + arguments)
  const results: ExtractedToolCall[] = [];

  for (const d of events) {
    const eventType = d.type as string | undefined;

    // response.function_call_arguments.done has complete data
    if (eventType === 'response.function_call_arguments.done') {
      const name = d.name as string | undefined;
      const args = d.arguments as string | undefined;
      if (name) {
        let input: Record<string, unknown> | string = args ?? '';
        try { input = JSON.parse(args ?? '{}'); } catch { /* keep as string */ }
        results.push({ toolName: name, toolInput: input, provider: 'openai' });
      }
      continue;
    }

    // Fallback: response.output_item.done with type=function_call
    if (eventType === 'response.output_item.done') {
      const item = d.item as Record<string, unknown> | undefined;
      if (item?.type === 'function_call') {
        const name = (item.name as string) ?? '';
        const args = (item.arguments as string) ?? '';
        if (name) {
          // Check if we already captured this via function_call_arguments.done
          const alreadyCaptured = results.some(r => r.toolName === name);
          if (!alreadyCaptured) {
            let input: Record<string, unknown> | string = args;
            try { input = JSON.parse(args); } catch { /* keep as string */ }
            results.push({ toolName: name, toolInput: input, provider: 'openai' });
          }
        }
      }
    }
  }

  return results;
}

function extractGeminiSSE(events: Record<string, unknown>[]): ExtractedToolCall[] {
  // Each Gemini SSE event has the same candidates[] structure as the JSON response
  const results: ExtractedToolCall[] = [];
  for (const d of events) {
    const extracted = extractGeminiJSON(d);
    results.push(...extracted);
  }
  return results;
}

export function extractToolCallsFromSSE(body: string): ExtractedToolCall[] {
  const events = parseSSEEvents(body);
  if (events.length === 0) return [];
  return extractToolCallsFromParsedEventsInternal(events);
}

// ---------- Pre-parsed events (skip text parsing) ----------

/** Shared detection logic for pre-parsed events */
function extractToolCallsFromParsedEventsInternal(events: Record<string, unknown>[]): ExtractedToolCall[] {
  // Anthropic: content_block_start / message_start
  const hasAnthropicEvents = events.some(e => e.type === 'content_block_start' || e.type === 'message_start');
  if (hasAnthropicEvents) return extractAnthropicSSE(events);

  // OpenAI Chat Completions: choices[]
  const hasOpenAIEvents = events.some(e => Array.isArray((e as Record<string, unknown>).choices));
  if (hasOpenAIEvents) return extractOpenAISSE(events);

  // OpenAI Responses API: response.output_item.added / response.function_call_arguments.*
  const hasResponsesEvents = events.some(e => {
    const t = e.type as string | undefined;
    return t?.startsWith('response.');
  });
  if (hasResponsesEvents) return extractOpenAIResponsesSSE(events);

  // Gemini: candidates[]
  const hasGeminiEvents = events.some(e => Array.isArray((e as Record<string, unknown>).candidates));
  if (hasGeminiEvents) return extractGeminiSSE(events);

  return [];
}

export function extractToolCallsFromParsedEvents(events: Record<string, unknown>[]): ExtractedToolCall[] {
  if (events.length === 0) return [];
  return extractToolCallsFromParsedEventsInternal(events);
}

// ---------- Auto-detect ----------

export function extractToolCalls(body: string, isStreaming: boolean): ExtractedToolCall[] {
  if (isStreaming || body.includes('data: ')) {
    return extractToolCallsFromSSE(body);
  }
  return extractToolCallsFromJSON(body);
}
