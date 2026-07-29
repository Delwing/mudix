import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PingTracker, type PingEventSource } from '../../../src/mud/connection/PingTracker';

/** Minimal stand-in for the session EventBus: records the handler registered
 *  for each event so a test can fire it directly. */
function makeSource() {
  const handlers: Record<string, () => void> = {};
  const source: PingEventSource = {
    on: ((event: string, handler: () => void) => {
      handlers[event] = handler;
      return () => { delete handlers[event]; };
    }) as PingEventSource['on'],
  };
  return { source, fire: (event: string) => handlers[event]?.() };
}

describe('PingTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('always sends a latency body, never a bare Core.Ping', () => {
    // A bare `Core.Ping` leaves an empty string after the module name, which
    // servers that unconditionally JSON-parse the body reject with a visible
    // parse error. The spec's `Core.Ping <latency>` form avoids it.
    const send = vi.fn();
    const { source, fire } = makeSource();
    const tracker = new PingTracker(send, () => {}, source);

    fire('gmcp.negotiated');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(0); // nothing measured yet
    tracker.destroy();
  });

  it('reports the previous round-trip on subsequent pings', () => {
    const send = vi.fn();
    const measured: Array<number | null> = [];
    const { source, fire } = makeSource();
    const nowSpy = vi.spyOn(performance, 'now');
    const tracker = new PingTracker(send, d => measured.push(d), source);

    nowSpy.mockReturnValue(1000);
    fire('gmcp.negotiated');
    nowSpy.mockReturnValue(1042);
    fire('gmcp.core.ping'); // 42ms round trip; starts the repeating interval

    expect(measured).toEqual([42]);

    nowSpy.mockReturnValue(5000);
    vi.advanceTimersByTime(3000);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(42);
    tracker.destroy();
    nowSpy.mockRestore();
  });
});
