import type Database from 'better-sqlite3';
import { encrypt, decrypt } from '../encryption.js';

export interface AuditLogRecord {
  id: string;
  request_id: string;
  encrypted_content: Buffer | null;
  iv: Buffer;
  auth_tag: Buffer;
  request_length: number;
  response_length: number;
  created_at: string;
}

export interface AuditLogMeta {
  id: string;
  request_id: string;
  request_length: number;
  response_length: number;
  created_at: string;
  session_id?: string | null;
  model?: string | null;
  status_code?: number | null;
  latency_ms?: number | null;
  stop_reason?: string | null;
}

export interface AuditSession {
  session_id: string;
  request_count: number;
  first_at: string;
  last_at: string;
  models: string;
}

// ---------- Parsed types for the API ----------

export interface ParsedMessage {
  role: string;
  content: ParsedContentBlock[];
}

export interface ParsedContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'other';
  text?: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
}

export interface ParsedAudit {
  request: {
    model: string | null;
    maxTokens: number | null;
    temperature: number | null;
    stream: boolean;
    system: string | null;
    tools: string[];
    messages: ParsedMessage[];
  };
  response: {
    model: string | null;
    stopReason: string | null;
    usage: Record<string, number>;
    content: ParsedContentBlock[];
  };
  raw: { request: string; response: string };
}

// ---------- Truncation helpers ----------

const MAX_TEXT = 1500;

function truncText(s: string, max: number = MAX_TEXT): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated, ${s.length} chars total]`;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (typeof b === 'string') return b;
      if (b?.type === 'text') return b.text ?? '';
      return '';
    }).join('\n');
  }
  return JSON.stringify(content);
}

function parseContentBlocks(content: unknown): ParsedContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: truncText(content) }];
  }
  if (!Array.isArray(content)) {
    return [{ type: 'text', text: truncText(JSON.stringify(content)) }];
  }
  return content.map((b): ParsedContentBlock => {
    if (typeof b === 'string') return { type: 'text', text: truncText(b) };
    if (b?.type === 'text') return { type: 'text', text: truncText(b.text ?? '') };
    if (b?.type === 'image' || b?.type === 'image_url') return { type: 'image' };
    if (b?.type === 'tool_use') {
      const inp = typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {}, null, 2);
      return { type: 'tool_use', toolName: b.name ?? '?', toolInput: truncText(inp, 800) };
    }
    if (b?.type === 'tool_result') {
      const inner = typeof b.content === 'string'
        ? b.content
        : Array.isArray(b.content)
          ? b.content.map((x: unknown) => typeof x === 'string' ? x : (x as Record<string, unknown>)?.text ?? JSON.stringify(x)).join('\n')
          : JSON.stringify(b.content ?? '');
      return { type: 'tool_result', text: truncText(inner, 800), isError: Boolean(b.is_error) };
    }
    return { type: 'other', text: truncText(JSON.stringify(b), 300) };
  });
}

// ---------- SSE parsing (for streaming responses) ----------

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

function reconstructFromSSE(events: Record<string, unknown>[]): {
  model: string | null;
  stopReason: string | null;
  usage: Record<string, number>;
  content: ParsedContentBlock[];
} {
  let model: string | null = null;
  let stopReason: string | null = null;
  const usage: Record<string, number> = {};
  const textBlocks: string[] = [];
  const toolBlocks: { name: string; input: string }[] = [];
  let curText = '', curToolName = '', curToolInput = '';

  for (const d of events) {
    // Anthropic SSE
    if (d.type === 'message_start') {
      const msg = d.message as Record<string, unknown> | undefined;
      if (msg?.model) model = msg.model as string;
      if (msg?.usage) Object.assign(usage, msg.usage);
    }
    if (d.type === 'content_block_start') {
      const cb = d.content_block as Record<string, unknown> | undefined;
      if (cb?.type === 'tool_use') curToolName = (cb.name as string) ?? '';
    }
    if (d.type === 'content_block_delta') {
      const delta = d.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta') curText += (delta.text as string) ?? '';
      if (delta?.type === 'input_json_delta') curToolInput += (delta.partial_json as string) ?? '';
    }
    if (d.type === 'content_block_stop') {
      if (curText) { textBlocks.push(curText); curText = ''; }
      if (curToolName) { toolBlocks.push({ name: curToolName, input: curToolInput }); curToolName = ''; curToolInput = ''; }
    }
    if (d.type === 'message_delta') {
      const delta = d.delta as Record<string, unknown> | undefined;
      if (delta?.stop_reason) stopReason = delta.stop_reason as string;
      if (d.usage) Object.assign(usage, d.usage);
    }
    // OpenAI SSE
    const choices = d.choices as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(choices)) {
      for (const c of choices) {
        const cDelta = c.delta as Record<string, unknown> | undefined;
        if (cDelta?.content) curText += cDelta.content as string;
        if (c.finish_reason) stopReason = c.finish_reason as string;
      }
    }
    if (d.model && !model) model = d.model as string;
    if (d.usage) Object.assign(usage, d.usage as Record<string, number>);
  }
  if (curText) textBlocks.push(curText);

  const content: ParsedContentBlock[] = [];
  for (const txt of textBlocks) {
    content.push({ type: 'text', text: truncText(txt, 3000) });
  }
  for (const tool of toolBlocks) {
    let inp = tool.input;
    try { inp = JSON.stringify(JSON.parse(tool.input), null, 2); } catch { /* keep as-is */ }
    content.push({ type: 'tool_use', toolName: tool.name, toolInput: truncText(inp, 1500) });
  }

  return { model, stopReason, usage, content };
}

// ---------- Main parse function ----------

export function parseAuditContent(reqStr: string, resStr: string): ParsedAudit {
  const result: ParsedAudit = {
    request: { model: null, maxTokens: null, temperature: null, stream: false, system: null, tools: [], messages: [] },
    response: { model: null, stopReason: null, usage: {}, content: [] },
    raw: { request: reqStr, response: resStr },
  };

  // --- Parse request ---
  try {
    const req = JSON.parse(reqStr);
    result.request.model = req.model ?? null;
    result.request.maxTokens = req.max_tokens ?? null;
    result.request.temperature = req.temperature ?? null;
    result.request.stream = Boolean(req.stream);

    if (req.system) {
      result.request.system = truncText(extractTextFromContent(req.system), 2000);
    }

    if (Array.isArray(req.tools)) {
      result.request.tools = req.tools.map((t: Record<string, unknown>) =>
        (t.name as string) ?? (t.function as Record<string, unknown>)?.name ?? '?'
      );
    }

    if (Array.isArray(req.messages)) {
      result.request.messages = req.messages.map((m: Record<string, unknown>): ParsedMessage => ({
        role: (m.role as string) ?? 'unknown',
        content: parseContentBlocks(m.content),
      }));
    }
  } catch {
    // JSON parse failed (likely truncated) — put raw text as a single message
    result.request.messages = [{
      role: 'raw',
      content: [{ type: 'text', text: truncText(reqStr, 3000) }],
    }];
  }

  // --- Parse response ---
  // Try JSON first
  try {
    const res = JSON.parse(resStr);
    result.response.model = res.model ?? null;
    result.response.stopReason = res.stop_reason ?? null;
    if (res.usage) result.response.usage = res.usage;

    // Anthropic format
    if (Array.isArray(res.content)) {
      result.response.content = parseContentBlocks(res.content);
    }
    // OpenAI format
    else if (Array.isArray(res.choices)) {
      for (const c of res.choices) {
        const m = c.message ?? c.delta ?? {};
        if (m.content) {
          result.response.content.push({ type: 'text', text: truncText(m.content, 3000) });
        }
      }
    }
    return result;
  } catch { /* not JSON */ }

  // Try SSE
  if (resStr.includes('data: ')) {
    const events = parseSSEEvents(resStr);
    if (events.length > 0) {
      const sse = reconstructFromSSE(events);
      result.response.model = sse.model;
      result.response.stopReason = sse.stopReason;
      result.response.usage = sse.usage;
      result.response.content = sse.content;
      return result;
    }
  }

  // Fallback: raw text
  result.response.content = [{ type: 'text', text: truncText(resStr, 3000) }];
  return result;
}

// ---------- Smart JSON body truncation for storage ----------

function truncateJsonBody(body: string, maxBytes: number): string {
  if (body.length <= maxBytes) return body;

  // Try to parse and truncate within the JSON structure
  try {
    const obj = JSON.parse(body);
    // Truncate system prompt
    if (typeof obj.system === 'string' && obj.system.length > 2000) {
      obj.system = obj.system.slice(0, 2000) + '...[truncated]';
    } else if (Array.isArray(obj.system)) {
      obj.system = obj.system.map((b: Record<string, unknown>) => {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.length > 2000) {
          return { ...b, text: (b.text as string).slice(0, 2000) + '...[truncated]' };
        }
        return b;
      });
    }
    // Remove tool input_schema (bulky, not needed for audit)
    if (Array.isArray(obj.tools)) {
      obj.tools = obj.tools.map((t: Record<string, unknown>) => ({
        name: t.name,
        description: typeof t.description === 'string'
          ? t.description.slice(0, 200) + (t.description.length > 200 ? '...' : '')
          : undefined,
      }));
    }
    // Truncate individual message contents
    if (Array.isArray(obj.messages)) {
      obj.messages = obj.messages.map((m: Record<string, unknown>) => {
        if (typeof m.content === 'string' && m.content.length > 3000) {
          return { ...m, content: m.content.slice(0, 3000) + '...[truncated]' };
        }
        if (Array.isArray(m.content)) {
          return {
            ...m,
            content: (m.content as Record<string, unknown>[]).map((b) => {
              if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 3000) {
                return { ...b, text: (b.text as string).slice(0, 3000) + '...[truncated]' };
              }
              if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > 1500) {
                return { ...b, content: (b.content as string).slice(0, 1500) + '...[truncated]' };
              }
              if (b.type === 'tool_use' && b.input) {
                const inp = typeof b.input === 'string' ? b.input : JSON.stringify(b.input);
                if (inp.length > 1500) {
                  return { ...b, input: inp.slice(0, 1500) + '...[truncated]' };
                }
              }
              return b;
            }),
          };
        }
        return m;
      });
    }
    const result = JSON.stringify(obj);
    // If still too big after smart truncation, fall back to raw truncation
    if (result.length > maxBytes) return result.slice(0, maxBytes);
    return result;
  } catch {
    // Not valid JSON, fall back to raw truncation
    return body.slice(0, maxBytes);
  }
}

// ---------- Repository ----------

export class AuditLogRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO audit_log (id, request_id, encrypted_content, iv, auth_tag, request_length, response_length)
      VALUES (@id, @request_id, @encrypted_content, @iv, @auth_tag, @request_length, @response_length)
    `);
  }

  insert(record: {
    id: string;
    request_id: string;
    requestBody: string;
    responseBody: string;
  }): void {
    const MAX_TOTAL = 512 * 1024;
    const reqBody = truncateJsonBody(record.requestBody, MAX_TOTAL / 2);
    const resBody = record.responseBody.length > MAX_TOTAL / 2
      ? record.responseBody.slice(0, MAX_TOTAL / 2)
      : record.responseBody;

    const content = JSON.stringify({ request: reqBody, response: resBody });
    const { encrypted, iv, authTag } = encrypt(content);

    this.insertStmt.run({
      id: record.id,
      request_id: record.request_id,
      encrypted_content: encrypted,
      iv,
      auth_tag: authTag,
      request_length: record.requestBody.length,
      response_length: record.responseBody.length,
    });
  }

  getByRequestId(requestId: string): { request: string; response: string } | null {
    const row = this.db.prepare(
      'SELECT * FROM audit_log WHERE request_id = ? LIMIT 1'
    ).get(requestId) as AuditLogRecord | undefined;

    if (!row || !row.encrypted_content) return null;

    const decrypted = decrypt({
      encrypted: row.encrypted_content,
      iv: row.iv,
      authTag: row.auth_tag,
    });

    return JSON.parse(decrypted) as { request: string; response: string };
  }

  getParsedByRequestId(requestId: string): ParsedAudit | null {
    const raw = this.getByRequestId(requestId);
    if (!raw) return null;
    return parseAuditContent(raw.request, raw.response);
  }

  getRecent(limit: number = 20): AuditLogMeta[] {
    return this.db.prepare(`
      SELECT a.id, a.request_id, a.request_length, a.response_length, a.created_at,
             r.session_id, r.model, r.status_code, r.latency_ms
      FROM audit_log a
      LEFT JOIN requests r ON r.id = a.request_id
      ORDER BY a.created_at DESC LIMIT ?
    `).all(limit) as AuditLogMeta[];
  }

  /** Get all audit entries for a session, in chronological order */
  getBySessionId(sessionId: string): AuditLogMeta[] {
    return this.db.prepare(`
      SELECT a.id, a.request_id, a.request_length, a.response_length, a.created_at,
             r.session_id, r.model, r.status_code, r.latency_ms
      FROM audit_log a
      INNER JOIN requests r ON r.id = a.request_id
      WHERE r.session_id = ?
      ORDER BY a.created_at ASC
    `).all(sessionId) as AuditLogMeta[];
  }

  /** Get sessions that have audit entries, ordered by most recent */
  getAuditSessions(limit: number = 30): AuditSession[] {
    return this.db.prepare(`
      SELECT r.session_id, COUNT(*) as request_count,
             MIN(a.created_at) as first_at, MAX(a.created_at) as last_at,
             GROUP_CONCAT(DISTINCT r.model) as models
      FROM audit_log a
      INNER JOIN requests r ON r.id = a.request_id
      WHERE r.session_id IS NOT NULL
      GROUP BY r.session_id
      ORDER BY last_at DESC
      LIMIT ?
    `).all(limit) as AuditSession[];
  }

  /** Get a full parsed session timeline: all requests in order with parsed content */
  getParsedSession(sessionId: string): Array<{ meta: AuditLogMeta; parsed: ParsedAudit }> {
    const entries = this.getBySessionId(sessionId);
    const results: Array<{ meta: AuditLogMeta; parsed: ParsedAudit }> = [];
    for (const entry of entries) {
      const raw = this.getByRequestId(entry.request_id);
      if (raw) {
        results.push({
          meta: entry,
          parsed: parseAuditContent(raw.request, raw.response),
        });
      }
    }
    return results;
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM audit_log WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}
