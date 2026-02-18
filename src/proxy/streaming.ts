/**
 * SSE parser — inspects streaming events for metrics/DLP without modifying the stream.
 * Raw bytes are always forwarded unmodified to clients.
 */

export interface SSEEvent {
  event?: string;
  data: string;
}

export type SSEEventHandler = (event: SSEEvent) => void;

export class SSEParser {
  private buffer = '';
  private currentEvent: string | undefined;
  private currentData: string[] = [];
  private onEvent: SSEEventHandler;

  constructor(onEvent: SSEEventHandler) {
    this.onEvent = onEvent;
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        this.currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        this.currentData.push(line.slice(6));
      } else if (line === '') {
        // Empty line = end of event
        if (this.currentData.length > 0) {
          this.onEvent({ event: this.currentEvent, data: this.currentData.join('\n') });
        }
        this.currentEvent = undefined;
        this.currentData = [];
      }
    }
  }

  flush(): void {
    // Emit any pending event
    if (this.currentData.length > 0) {
      this.onEvent({ event: this.currentEvent, data: this.currentData.join('\n') });
      this.currentEvent = undefined;
      this.currentData = [];
    }

    // Check remaining buffer for a final data line
    if (this.buffer.trim()) {
      const line = this.buffer.trim();
      if (line.startsWith('data: ')) {
        this.onEvent({ event: undefined, data: line.slice(6) });
      }
    }
    this.buffer = '';
  }
}

/** Extract JSON data from an SSE event, returns null if not valid JSON */
export function parseSSEData(event: SSEEvent): Record<string, unknown> | null {
  if (event.data === '[DONE]') return null;
  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}
