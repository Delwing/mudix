import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

type Events = {
    tick: [];
    other: [];
    payload: [string];
};

describe('EventBus — reentrant dispatch', () => {
    it('does not skip handlers when a nested emit compacts the bucket', () => {
        const bus = new EventBus<Events>();
        const seen: string[] = [];

        // `a` unsubscribes itself and re-enters emit('tick'). The nested emit
        // used to splice `a`'s tombstone out of the very array the outer loop
        // was iterating, shifting every later index down one — so `b` was
        // skipped by the outer dispatch.
        const a = () => {
            seen.push('a');
            bus.off('tick', a);
            if (seen.filter(s => s === 'a').length === 1) bus.emit('tick');
        };
        bus.on('tick', a);
        bus.on('tick', () => seen.push('b'));
        bus.on('tick', () => seen.push('c'));

        bus.emit('tick');

        // Outer dispatch must still reach b and c; the nested emit sees a as
        // dead and reaches b and c again.
        expect(seen).toEqual(['a', 'b', 'c', 'b', 'c']);
    });

    it('keeps listeners registered while a nested emit emptied and deleted the bucket', () => {
        const bus = new EventBus<Events>();
        const late = vi.fn();

        // `solo` is the only 'tick' listener. It removes itself, then a nested
        // emit compacts the (now empty) bucket and deletes the key. Registering
        // afterwards installs a *fresh* array under that key — which the outer
        // emit's compaction pass then deleted, because it was still holding the
        // stale reference.
        const solo = () => {
            bus.off('tick', solo);
            bus.emit('tick');
            bus.on('tick', late);
        };
        bus.on('tick', solo);

        bus.emit('tick');
        expect(bus.listenerCount('tick')).toBe(1);

        bus.emit('tick');
        expect(late).toHaveBeenCalledTimes(1);
    });

    it('stops dispatching once a handler clears the bus', () => {
        const bus = new EventBus<Events>();
        const after = vi.fn();

        bus.on('tick', () => bus.clear());
        bus.on('tick', after);

        bus.emit('tick');

        expect(after).not.toHaveBeenCalled();
    });

    it('honours off() issued by an earlier handler in the same dispatch', () => {
        const bus = new EventBus<Events>();
        const second = vi.fn();

        bus.on('tick', () => bus.off('tick', second));
        bus.on('tick', second);

        bus.emit('tick');

        expect(second).not.toHaveBeenCalled();
    });
});

describe('EventBus — bookkeeping', () => {
    it('does not accumulate tombstones across on/off cycles without an emit', () => {
        const bus = new EventBus<Events>();
        const handler = () => {};

        for (let i = 0; i < 100; i++) {
            bus.on('tick', handler);
            bus.off('tick', handler);
        }

        expect(bus.listenerCount('tick')).toBe(0);

        bus.on('tick', handler);
        expect(bus.listenerCount('tick')).toBe(1);
    });

    it('fires once-listeners exactly once and drops them', () => {
        const bus = new EventBus<Events>();
        const once = vi.fn();

        bus.on('tick', once, { once: true });
        bus.emit('tick');
        bus.emit('tick');

        expect(once).toHaveBeenCalledTimes(1);
        expect(bus.listenerCount('tick')).toBe(0);
    });

    it('isolates a throwing handler from the rest of the dispatch', () => {
        const bus = new EventBus<Events>();
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const after = vi.fn();

        bus.on('tick', () => { throw new Error('boom'); });
        bus.on('tick', after);

        expect(bus.emit('tick')).toBe(2);
        expect(after).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it('unsubscribes via an AbortSignal', () => {
        const bus = new EventBus<Events>();
        const controller = new AbortController();
        const handler = vi.fn();

        bus.on('tick', handler, { signal: controller.signal });
        bus.emit('tick');
        controller.abort();
        bus.emit('tick');

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('passes emit arguments through to handlers', () => {
        const bus = new EventBus<Events>();
        const handler = vi.fn();

        bus.on('payload', handler);
        bus.emit('payload', 'hello');

        expect(handler).toHaveBeenCalledWith('hello');
    });
});
