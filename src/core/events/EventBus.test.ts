import { describe, it, expect } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('delivers events to subscribers with payload', () => {
    const bus = new EventBus();
    let got: unknown = null;
    bus.on('level_started', (p) => {
      got = p;
    });
    bus.emit('level_started', { level_id: 'x' });
    expect(got).toEqual({ level_id: 'x' });
  });

  it('unsubscribes via the returned disposer and via off()', () => {
    const bus = new EventBus();
    let count = 0;
    const handler = () => {
      count += 1;
    };
    const dispose = bus.on('move_made', handler);
    bus.emit('move_made');
    dispose();
    bus.emit('move_made');
    expect(count).toBe(1);

    bus.on('undo_used', handler);
    bus.off('undo_used', handler);
    bus.emit('undo_used');
    expect(count).toBe(1);
  });

  it('a throwing handler does not break other handlers', () => {
    const bus = new EventBus();
    let delivered = false;
    bus.on('error_occurred', () => {
      throw new Error('boom');
    });
    bus.on('error_occurred', () => {
      delivered = true;
    });
    expect(() => bus.emit('error_occurred')).not.toThrow();
    expect(delivered).toBe(true);
  });
});
