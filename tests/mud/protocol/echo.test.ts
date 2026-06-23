import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EchoHandler } from '../../../src/mud/protocol/echo';
import { ECHO_WILL, ECHO_WONT, ECHO_DO, ECHO_DONT } from '../../../src/mud/protocol/constants';

const STABLE_MS = 500;

function makeHandler() {
  const sent: string[] = [];
  const masks: boolean[] = [];
  let anomalies = 0;
  const handler = new EchoHandler(
    (data) => sent.push(data),
    (maskInput) => masks.push(maskInput),
    () => { anomalies++; },
  );
  handler.reset(); // establishes connectionStartAt, clears state
  return { handler, sent, masks, anomalies: () => anomalies };
}

describe('EchoHandler — server-wide echo vs password masking', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('treats connect-time WILL ECHO (before any output) as server-wide echo: suppresses local echo but does NOT mask', () => {
    const { handler, sent, masks } = makeHandler();

    // Opening negotiation burst — no server output yet.
    handler.processData(ECHO_WILL);
    vi.advanceTimersByTime(STABLE_MS);

    // Local echo is suppressed (server echoes for us)…
    expect(handler.serverEchoing).toBe(true);
    // …but the input line is NOT masked.
    expect(handler.passwordMode).toBe(false);
    // We still ack the option on the wire.
    expect(sent).toContain(ECHO_DO);
    // The only mask signal emitted (if any) is false.
    expect(masks.every(m => m === false)).toBe(true);
  });

  it('masks for a WILL ECHO that arrives after the server has printed output (password prompt)', () => {
    const { handler, masks } = makeHandler();

    // Name prompt etc. has already been printed.
    handler.processData('By what name do you wish to be known? ');
    // Then the password prompt enables ECHO.
    handler.processData(ECHO_WILL);
    vi.advanceTimersByTime(STABLE_MS);

    expect(handler.serverEchoing).toBe(true);
    expect(handler.passwordMode).toBe(true);
    expect(masks[masks.length - 1]).toBe(true);

    // WONT ECHO ends password mode.
    handler.processData(ECHO_WONT);
    vi.advanceTimersByTime(STABLE_MS);
    expect(handler.passwordMode).toBe(false);
    expect(masks[masks.length - 1]).toBe(false);
  });

  it('does not mask the name on a full-server-echo MUD, but masks a later real password toggle', () => {
    const { handler, masks } = makeHandler();

    // Connect-time server-wide echo.
    handler.processData(ECHO_WILL);
    vi.advanceTimersByTime(STABLE_MS);
    expect(handler.passwordMode).toBe(false);

    // Server prints the name prompt (still echoing for us).
    handler.processData('By what name do you wish to be known? ');

    // Server releases echo, then re-enables it for the password.
    handler.processData(ECHO_WONT);
    vi.advanceTimersByTime(STABLE_MS);
    expect(handler.serverEchoing).toBe(false);

    handler.processData(ECHO_WILL);
    vi.advanceTimersByTime(STABLE_MS);
    expect(handler.passwordMode).toBe(true);
    expect(masks[masks.length - 1]).toBe(true);
  });

  it('does not arm the password safety timeout for connect-time server-wide echo', () => {
    const { handler, sent } = makeHandler();

    handler.processData(ECHO_WILL);
    vi.advanceTimersByTime(STABLE_MS);
    expect(handler.serverEchoing).toBe(true);

    // Past the 60s password-mode safety window: a password engagement would
    // force ECHO off here, but server-wide echo must stay on.
    vi.advanceTimersByTime(61_000);
    expect(handler.serverEchoing).toBe(true);
    expect(sent).not.toContain(ECHO_DONT);
  });
});
