/**
 * StreamingToolGuard — intercepts SSE events during streaming responses.
 *
 * Text content blocks are forwarded immediately. Tool_use content blocks are
 * buffered until complete (content_block_stop), then evaluated against rules.
 * Dangerous tool calls are replaced with a text block warning.
 *
 * Currently supports Anthropic SSE format. OpenAI streaming tool calls are
 * passed through and audited post-send (onResponseComplete).
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

  // Buffering state for current tool_use block
  private buffering = false;
  private bufferEvents: string[] = [];
  private toolName = '';
  private toolInput = '';
  private toolIndex = -1;

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
   * Returns true if the event was handled (forwarded or buffered), false if not an Anthropic event.
   */
  processEvent(rawEvent: string, parsed: Record<string, unknown> | null): void {
    if (!parsed) {
      // Non-JSON event ([DONE], comments, etc.) — forward as-is
      this.onForward(rawEvent);
      return;
    }

    const eventType = parsed.type as string | undefined;

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
        this.evaluateAndFlush();
        return;
      }
      this.onForward(rawEvent);
      return;
    }

    // ── All other events (message_start, message_delta, ping, etc.) ──
    this.onForward(rawEvent);
  }

  /** Evaluate the buffered tool_use block and either flush or replace it. */
  private evaluateAndFlush(): void {
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

    // Reset buffer state
    this.buffering = false;
    this.bufferEvents = [];
    this.toolName = '';
    this.toolInput = '';
    this.toolIndex = -1;
  }

  /** Flush any remaining buffered data (e.g., if stream ended mid-block). */
  flush(): void {
    if (this.buffering && this.bufferEvents.length > 0) {
      // Stream ended mid-block — forward as-is (incomplete, can't evaluate)
      for (const evt of this.bufferEvents) {
        this.onForward(evt);
      }
      this.buffering = false;
      this.bufferEvents = [];
    }
  }
}
