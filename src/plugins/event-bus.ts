import { EventEmitter } from 'node:events';

export class PluginEventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  emit(event: string, data: unknown): void {
    this.emitter.emit(event, data);
  }

  on(event: string, handler: (data: unknown) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    this.emitter.off(event, handler);
  }

  removeAllListeners(event?: string): void {
    this.emitter.removeAllListeners(event);
  }
}
