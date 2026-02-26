import { describe, it, expect, vi } from 'vitest';
import { PluginEventBus } from '../../../src/plugins/event-bus.js';

describe('PluginEventBus', () => {
  it('emit + on delivers data to listener', () => {
    const bus = new PluginEventBus();
    const handler = vi.fn();

    bus.on('test-event', handler);
    bus.emit('test-event', { foo: 'bar' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('off removes the listener', () => {
    const bus = new PluginEventBus();
    const handler = vi.fn();

    bus.on('test-event', handler);
    bus.off('test-event', handler);
    bus.emit('test-event', { foo: 'bar' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('supports multiple listeners on the same event', () => {
    const bus = new PluginEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('multi', handler1);
    bus.on('multi', handler2);
    bus.emit('multi', 42);

    expect(handler1).toHaveBeenCalledWith(42);
    expect(handler2).toHaveBeenCalledWith(42);
  });

  it('removeAllListeners clears all handlers', () => {
    const bus = new PluginEventBus();
    const handler = vi.fn();

    bus.on('evt', handler);
    bus.removeAllListeners('evt');
    bus.emit('evt', 'data');

    expect(handler).not.toHaveBeenCalled();
  });
});
