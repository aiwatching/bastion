/**
 * StreamingToolGuard — intercepts SSE events during streaming responses.
 *
 * Text content blocks are forwarded immediately. Tool_use content blocks are
 * buffered until complete, then evaluated against rules.
 * Dangerous tool calls are replaced with a text block warning.
 *
 * Supports both Anthropic and OpenAI SSE formats.
 *
 * Anthropic: content_block_start → content_block_delta → content_block_stop (per block)
 * OpenAI:    choices[].delta.tool_calls[] accumulates until finish_reason appears
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

  // ── OpenAI buffering state ──
  private oaiBuffering = false;
  private oaiBufferEvents: string[] = [];
  private oaiToolCalls: Map<number, { name: string; args: string }> = new Map();

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

  /** Flush any remaining buffered data (e.g., if stream ended mid-block). */
  flush(): void {
    // Anthropic pending buffer
    if (this.buffering && this.bufferEvents.length > 0) {
      // Stream ended mid-block — forward as-is (incomplete, can't evaluate)
      for (const evt of this.bufferEvents) {
        this.onForward(evt);
      }
      this.buffering = false;
      this.bufferEvents = [];
    }

    // OpenAI pending buffer
    if (this.oaiBuffering && this.oaiBufferEvents.length > 0) {
      // Stream ended without finish_reason — forward as-is
      for (const evt of this.oaiBufferEvents) {
        this.onForward(evt);
      }
      this.oaiBuffering = false;
      this.oaiBufferEvents = [];
      this.oaiToolCalls.clear();
    }
  }
}
