/**
 * StreamingToolGuard — intercepts SSE events during streaming responses.
 *
 * Text content blocks are forwarded immediately. Tool_use content blocks are
 * buffered until complete, then evaluated against rules.
 * Dangerous tool calls are replaced with a text block warning.
 *
 * Supports Anthropic, OpenAI Chat Completions, and OpenAI Responses API formats.
 *
 * Anthropic:        content_block_start → content_block_delta → content_block_stop (per block)
 * OpenAI Chat:      choices[].delta.tool_calls[] accumulates until finish_reason appears
 * OpenAI Responses: response.output_item.added(function_call) → response.function_call_arguments.delta → .done
 */

import { matchRules, BUILTIN_RULES, type ToolGuardRule, type RuleMatch } from './rules.js';
import { shouldAlert } from './alert.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('streaming-guard');

export interface StreamingGuardConfig {
  blockMinSeverity: string;
  rules?: ToolGuardRule[];
}

export interface StreamingGuardResult {
  toolName: string;
  ruleMatch: RuleMatch;
  blocked: boolean;
}

export class StreamingToolGuard {
  private config: StreamingGuardConfig;
  private rules: ToolGuardRule[];
  private onForward: (data: string) => void;

  // ── Anthropic buffering state ──
  private buffering = false;
  private bufferEvents: string[] = [];
  private toolName = '';
  private toolInput = '';
  private toolIndex = -1;
  private anthropicBlocked = false; // true after a tool_use block was blocked, so message_delta can be fixed

  // ── OpenAI Chat Completions buffering state ──
  private oaiBuffering = false;
  private oaiBufferEvents: string[] = [];
  private oaiToolCalls: Map<number, { name: string; args: string }> = new Map();

  // ── OpenAI Responses API buffering state ──
  private respBuffering = false;
  private respBufferEvents: string[] = [];
  private respToolName = '';
  private respToolArgs = '';
  private responsesApiBlocked = false; // true after a function_call was blocked, so output_item.done can be suppressed

  // Results for post-stream reporting
  public results: StreamingGuardResult[] = [];

  constructor(
    config: StreamingGuardConfig,
    onForward: (data: string) => void,
  ) {
    this.config = config;
    this.rules = config.rules ?? BUILTIN_RULES;
    this.onForward = onForward;
  }

  /**
   * Process a single SSE event (raw text including "event:" and "data:" lines + trailing newline).
   */
  processEvent(rawEvent: string, parsed: Record<string, unknown> | null): void {
    if (!parsed) {
      // Non-JSON event ([DONE], comments, etc.) — forward as-is
      this.onForward(rawEvent);
      return;
    }

    const eventType = parsed.type as string | undefined;

    // ═══════════════════════════════════════════
    // Anthropic format (has .type field)
    // ═══════════════════════════════════════════

    // ── content_block_start ──
    if (eventType === 'content_block_start') {
      const cb = parsed.content_block as Record<string, unknown> | undefined;
      if (cb?.type === 'tool_use') {
        // Start buffering this tool_use block
        this.buffering = true;
        this.bufferEvents = [rawEvent];
        this.toolName = (cb.name as string) ?? '';
        this.toolInput = '';
        this.toolIndex = (parsed.index as number) ?? -1;
        return;
      }
      // Text or other block — forward immediately
      this.onForward(rawEvent);
      return;
    }

    // ── content_block_delta ──
    if (eventType === 'content_block_delta') {
      if (this.buffering && (parsed.index as number) === this.toolIndex) {
        this.bufferEvents.push(rawEvent);
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'input_json_delta') {
          this.toolInput += (delta.partial_json as string) ?? '';
        }
        return;
      }
      // Not our buffered block — forward
      this.onForward(rawEvent);
      return;
    }

    // ── content_block_stop ──
    if (eventType === 'content_block_stop') {
      if (this.buffering && (parsed.index as number) === this.toolIndex) {
        this.bufferEvents.push(rawEvent);
        this.evaluateAndFlushAnthropic();
        return;
      }
      this.onForward(rawEvent);
      return;
    }

    // ═══════════════════════════════════════════
    // OpenAI format (has .choices[] field)
    // ═══════════════════════════════════════════
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0];
      const delta = choice.delta as Record<string, unknown> | undefined;
      const finishReason = choice.finish_reason as string | null;

      // Detect tool_calls in delta
      if (delta) {
        const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(toolCalls)) {
          this.oaiBuffering = true;
          this.oaiBufferEvents.push(rawEvent);
          for (const tc of toolCalls) {
            const idx = (tc.index as number) ?? 0;
            const fn = tc.function as Record<string, unknown> | undefined;
            if (fn?.name) {
              this.oaiToolCalls.set(idx, { name: fn.name as string, args: '' });
            }
            if (fn?.arguments && this.oaiToolCalls.has(idx)) {
              this.oaiToolCalls.get(idx)!.args += fn.arguments as string;
            }
          }
          return;
        }
      }

      // finish_reason signals end of tool calls
      if (finishReason && this.oaiBuffering) {
        this.oaiBufferEvents.push(rawEvent);
        this.evaluateAndFlushOpenAI();
        return;
      }
    }

    // ═══════════════════════════════════════════
    // OpenAI Responses API format (has .type starting with "response.")
    // ═══════════════════════════════════════════
    if (eventType?.startsWith('response.')) {
      // response.output_item.added with type=function_call → start buffering
      if (eventType === 'response.output_item.added') {
        const item = parsed.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call') {
          this.respBuffering = true;
          this.respBufferEvents = [rawEvent];
          this.respToolName = (item.name as string) ?? '';
          this.respToolArgs = '';
          return;
        }
        this.onForward(rawEvent);
        return;
      }

      // response.function_call_arguments.delta → accumulate args
      if (eventType === 'response.function_call_arguments.delta') {
        if (this.respBuffering) {
          this.respBufferEvents.push(rawEvent);
          this.respToolArgs += (parsed.delta as string) ?? '';
          return;
        }
        this.onForward(rawEvent);
        return;
      }

      // response.function_call_arguments.done → evaluate
      if (eventType === 'response.function_call_arguments.done') {
        if (this.respBuffering) {
          this.respBufferEvents.push(rawEvent);
          // Use complete data from .done event
          this.respToolName = (parsed.name as string) ?? this.respToolName;
          this.respToolArgs = (parsed.arguments as string) ?? this.respToolArgs;
          this.evaluateAndFlushResponses();
          return;
        }
        this.onForward(rawEvent);
        return;
      }

      // response.output_item.done — if we missed .arguments.done, flush here
      if (eventType === 'response.output_item.done') {
        if (this.respBuffering) {
          this.respBufferEvents.push(rawEvent);
          const item = parsed.item as Record<string, unknown> | undefined;
          if (item?.type === 'function_call') {
            this.respToolName = (item.name as string) ?? this.respToolName;
            this.respToolArgs = (item.arguments as string) ?? this.respToolArgs;
          }
          this.evaluateAndFlushResponses();
          return;
        }
        // If a function_call was blocked earlier via .arguments.done, suppress this event.
        // Without this, OpenClaw sees output_item.done for a function_call it never received
        // arguments for, and hangs waiting to submit tool results.
        if (this.responsesApiBlocked) {
          const item = parsed.item as Record<string, unknown> | undefined;
          if (item?.type === 'function_call') return; // suppress leaked function_call signal
        }
        this.onForward(rawEvent);
        return;
      }

      // response.completed — strip blocked function_call items from output[]
      // The upstream still sends response.completed with the original function_call in output[].
      // Without stripping it, clients like OpenClaw parse response.completed, find a function_call,
      // and hang waiting to submit tool results — even though output_item.done was already suppressed.
      if (eventType === 'response.completed' && this.responsesApiBlocked) {
        const resp = parsed.response as Record<string, unknown> | undefined;
        if (resp && Array.isArray(resp.output)) {
          const modified = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
          const mResp = modified.response as Record<string, unknown>;
          mResp.output = (resp.output as Record<string, unknown>[]).filter(
            (item) => (item as Record<string, unknown>).type !== 'function_call',
          );
          this.onForward(`data: ${JSON.stringify(modified)}\n\n`);
          return;
        }
      }

      // All other response.* events — forward
      this.onForward(rawEvent);
      return;
    }

    // ── message_delta: fix stop_reason if a tool_use block was blocked ──
    // Non-streaming path already rewrites stop_reason in replaceBlockedToolCalls().
    // For streaming, the guard replaced the tool_use content block with a text block,
    // but the upstream still sends stop_reason="tool_use". Clients like OpenClaw see
    // no tool_use block yet stop_reason=tool_use and hang waiting for tool execution.
    if (eventType === 'message_delta' && this.anthropicBlocked) {
      const delta = parsed.delta as Record<string, unknown> | undefined;
      if (delta?.stop_reason === 'tool_use') {
        const modified = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
        (modified.delta as Record<string, unknown>).stop_reason = 'end_turn';
        const prefix = rawEvent.startsWith('event:') ? 'event: message_delta\n' : '';
        this.onForward(`${prefix}data: ${JSON.stringify(modified)}\n\n`);
        return;
      }
    }

    // ── All other events (message_start, message_delta, ping, etc.) ──
    this.onForward(rawEvent);
  }

  /** Evaluate the buffered Anthropic tool_use block and either flush or replace it. */
  private evaluateAndFlushAnthropic(): void {
    let input: Record<string, unknown> | string = this.toolInput;
    try { input = JSON.parse(this.toolInput); } catch { /* keep as string */ }

    const ruleMatch = matchRules(this.toolName, input, this.rules);
    const shouldBlock = ruleMatch && shouldAlert(ruleMatch.rule.severity, this.config.blockMinSeverity);

    if (ruleMatch) {
      this.results.push({ toolName: this.toolName, ruleMatch, blocked: Boolean(shouldBlock) });
    }

    if (shouldBlock) {
      log.warn('Blocking streaming tool call', {
        toolName: this.toolName,
        rule: ruleMatch!.rule.id,
        severity: ruleMatch!.rule.severity,
      });

      this.anthropicBlocked = true;

      // Replace the tool_use block with a text warning block
      const warning = `[BLOCKED by Bastion Tool Guard] Tool "${this.toolName}" was blocked: ${ruleMatch!.rule.name} (${ruleMatch!.rule.severity})`;
      const idx = this.toolIndex;

      const replacementEvents = [
        `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: warning } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: idx })}\n\n`,
      ];

      for (const evt of replacementEvents) {
        this.onForward(evt);
      }
    } else {
      // Safe — flush all buffered events
      for (const evt of this.bufferEvents) {
        this.onForward(evt);
      }
    }

    // Reset Anthropic buffer state
    this.buffering = false;
    this.bufferEvents = [];
    this.toolName = '';
    this.toolInput = '';
    this.toolIndex = -1;
  }

  /** Evaluate all buffered OpenAI tool calls and either flush or replace. */
  private evaluateAndFlushOpenAI(): void {
    const blockedTools: string[] = [];

    for (const [, tc] of this.oaiToolCalls) {
      let input: Record<string, unknown> | string = tc.args;
      try { input = JSON.parse(tc.args); } catch { /* keep as string */ }

      const ruleMatch = matchRules(tc.name, input, this.rules);
      const shouldBlock = ruleMatch && shouldAlert(ruleMatch.rule.severity, this.config.blockMinSeverity);

      if (ruleMatch) {
        this.results.push({ toolName: tc.name, ruleMatch, blocked: Boolean(shouldBlock) });
      }

      if (shouldBlock) {
        blockedTools.push(`${tc.name}: ${ruleMatch!.rule.name} (${ruleMatch!.rule.severity})`);
        log.warn('Blocking streaming tool call', {
          toolName: tc.name,
          rule: ruleMatch!.rule.id,
          severity: ruleMatch!.rule.severity,
        });
      }
    }

    if (blockedTools.length > 0) {
      // Replace tool calls with a text warning + stop
      const warning = `[BLOCKED by Bastion Tool Guard] ${blockedTools.join('; ')}`;
      const replacement =
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: warning }, finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`;
      this.onForward(replacement);
    } else {
      // Safe — flush all buffered events
      for (const evt of this.oaiBufferEvents) {
        this.onForward(evt);
      }
    }

    // Reset OpenAI buffer state
    this.oaiBuffering = false;
    this.oaiBufferEvents = [];
    this.oaiToolCalls.clear();
  }

  /** Evaluate buffered OpenAI Responses API tool call and either flush or replace. */
  private evaluateAndFlushResponses(): void {
    let input: Record<string, unknown> | string = this.respToolArgs;
    try { input = JSON.parse(this.respToolArgs); } catch { /* keep as string */ }

    const ruleMatch = matchRules(this.respToolName, input, this.rules);
    const shouldBlock = ruleMatch && shouldAlert(ruleMatch.rule.severity, this.config.blockMinSeverity);

    if (ruleMatch) {
      this.results.push({ toolName: this.respToolName, ruleMatch, blocked: Boolean(shouldBlock) });
    }

    if (shouldBlock) {
      log.warn('Blocking streaming tool call', {
        toolName: this.respToolName,
        rule: ruleMatch!.rule.id,
        severity: ruleMatch!.rule.severity,
      });

      this.responsesApiBlocked = true;

      // Replace the function call with a text output item warning
      const warning = `[BLOCKED by Bastion Tool Guard] Tool "${this.respToolName}" was blocked: ${ruleMatch!.rule.name} (${ruleMatch!.rule.severity})`;
      const replacement =
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: warning })}\n\n` +
        `data: ${JSON.stringify({ type: 'response.output_text.done', text: warning })}\n\n`;
      this.onForward(replacement);
    } else {
      // Safe — flush all buffered events
      for (const evt of this.respBufferEvents) {
        this.onForward(evt);
      }
    }

    // Reset Responses API buffer state
    this.respBuffering = false;
    this.respBufferEvents = [];
    this.respToolName = '';
    this.respToolArgs = '';
  }

  /** Flush any remaining buffered data (e.g., if stream ended mid-block). */
  flush(): void {
    // Anthropic pending buffer
    if (this.buffering && this.bufferEvents.length > 0) {
      for (const evt of this.bufferEvents) {
        this.onForward(evt);
      }
      this.buffering = false;
      this.bufferEvents = [];
    }

    // OpenAI Chat Completions pending buffer
    if (this.oaiBuffering && this.oaiBufferEvents.length > 0) {
      for (const evt of this.oaiBufferEvents) {
        this.onForward(evt);
      }
      this.oaiBuffering = false;
      this.oaiBufferEvents = [];
      this.oaiToolCalls.clear();
    }

    // OpenAI Responses API pending buffer
    if (this.respBuffering && this.respBufferEvents.length > 0) {
      for (const evt of this.respBufferEvents) {
        this.onForward(evt);
      }
      this.respBuffering = false;
      this.respBufferEvents = [];
      this.respToolName = '';
      this.respToolArgs = '';
    }
  }
}
