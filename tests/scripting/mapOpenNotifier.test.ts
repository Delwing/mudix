import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MapOpenNotifier } from '../../src/scripting/MapOpenNotifier';

// MapOpenNotifier defers mapOpenEvent off the (boot) critical path (issue #2):
// the raise runs on a macrotask, the once-latch dedupes repeat opens, and a
// pending raise can be cancelled on engine teardown.
describe('MapOpenNotifier', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('defers the raise to a macrotask rather than firing synchronously', () => {
    const raise = vi.fn();
    const n = new MapOpenNotifier(raise);
    n.notify();
    // Not raised inline — that is the whole point (don't jank boot/render).
    expect(raise).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it('fires at most once across repeated notify() calls (the latch)', () => {
    const raise = vi.fn();
    const n = new MapOpenNotifier(raise);
    n.notify();
    n.notify();
    vi.runAllTimers();
    n.notify(); // a late re-open is still silent
    vi.runAllTimers();
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it('dispose() cancels a still-pending deferred raise', () => {
    const raise = vi.fn();
    const n = new MapOpenNotifier(raise);
    n.notify();
    n.dispose();
    vi.runAllTimers();
    expect(raise).not.toHaveBeenCalled();
  });

  it('dispose() after the raise already fired is a harmless no-op', () => {
    const raise = vi.fn();
    const n = new MapOpenNotifier(raise);
    n.notify();
    vi.runAllTimers();
    expect(() => n.dispose()).not.toThrow();
    expect(raise).toHaveBeenCalledTimes(1);
  });
});
