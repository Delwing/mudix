import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MudClient } from '../../../src/mud/connection/MudClient';
import { EventBus } from '../../../src/core/EventBus';
import { TELNET_EOR } from '../../../src/mud/protocol/constants';
import { AnsiAwareBuffer } from '../../../src/mud/text/FormatState';
import type { MudClientEvents } from '../../../src/mud/events';

// A prompt followed by an erase-to-end-of-line (ESC[K) that the server splits
// across frames so the bare ESC lands at the end of the first chunk. The idle
// timer used to flush the chunk and drop the lone ESC, leaking `[K` as text.
// Render-level assertion: parse each emitted chunk the way the output area does
// (AnsiAwareBuffer consumes escapes) and check the *visible* text.
function makeClient() {
  const bus = new EventBus<MudClientEvents>();
  const client = new MudClient({ url: 'ws://test.invalid' }, bus);
  const visible: string[] = [];
  bus.on('flushLines', (g) => {
    for (const x of g) for (const line of x.text.split('\n')) {
      visible.push(new AnsiAwareBuffer(line).text);
    }
  });
  return { client, visible };
}

describe('split ANSI escape across prompt-tail flush', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not leak [K when ESC[K is split across the idle-timer flush', () => {
    const { client, visible } = makeClient();
    client.feedTelnet('By what name do you wish to be known? \x1b');
    vi.advanceTimersByTime(400); // idle timer fires mid-escape
    client.feedTelnet('[K');
    vi.advanceTimersByTime(400);

    const joined = visible.join('');
    expect(joined).toContain('By what name do you wish to be known? ');
    expect(joined).not.toContain('[K');
  });

  it('consumes a whole ESC[K arriving in one frame', () => {
    const { client, visible } = makeClient();
    client.feedTelnet('Prompt> \x1b[K' + TELNET_EOR);
    vi.advanceTimersByTime(400);
    const joined = visible.join('');
    expect(joined).toContain('Prompt> ');
    expect(joined).not.toContain('[K');
  });
});

import { TELNET_EOR as EOR_MARK } from '../../../src/mud/protocol/constants';

describe('Last Outpost prompt frame (IAC EOR + ESC[K)', () => {
  it('renders the prompt without a leaked [K', () => {
    const bus = new EventBus<MudClientEvents>();
    const client = new MudClient({ url: 'ws://test.invalid' }, bus);
    const visible: string[] = [];
    bus.on('flushLines', (g) => {
      for (const x of g) for (const line of x.text.split('\n')) {
        visible.push(new AnsiAwareBuffer(line).text);
      }
    });
    // Exactly what the server sends: prompt text, IAC EOR, then ESC[K.
    client.feedTelnet('By what name do you wish to be known? ' + EOR_MARK + '\x1b[K');
    const joined = visible.join('');
    expect(joined).toContain('By what name do you wish to be known? ');
    expect(joined).not.toContain('[K');
  });
});
