// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MudClient, MUD_TELNET_SUBPROTOCOL } from '../../../src/mud/connection/MudClient';
import { EventBus } from '../../../src/core/EventBus';
import type { MudClientEvents } from '../../../src/mud/events';

/** Captures the constructor's `protocols` argument so we can assert what the
 *  client advertised in the opening handshake. `protocol` mirrors the server's
 *  selection (settable per-test before onopen fires). */
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  binaryType = '';
  protocol = '';
  sent: Uint8Array[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(public url: string, public requestedProtocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }
  send(bytes: Uint8Array) { this.sent.push(bytes); }
  close() { this.readyState = MockWebSocket.CLOSED; }
}

describe('WebSocket subprotocol advertisement', () => {
  let realWebSocket: unknown;
  let realAddEventListener: unknown;

  beforeEach(() => {
    realWebSocket = (globalThis as Record<string, unknown>).WebSocket;
    realAddEventListener = (globalThis as Record<string, unknown>).addEventListener;
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocket as unknown;
    (globalThis as Record<string, unknown>).addEventListener = () => {};
    MockWebSocket.instances = [];
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).WebSocket = realWebSocket;
    (globalThis as Record<string, unknown>).addEventListener = realAddEventListener;
  });

  it('opens a bare socket (no subprotocol argument) by default', () => {
    const client = new MudClient({ url: 'ws://test.invalid' }, new EventBus<MudClientEvents>());
    client.connect();
    expect(MockWebSocket.instances[0].requestedProtocols).toBeUndefined();
  });

  it('advertises telnet.mudstandards.org when configured', () => {
    const client = new MudClient(
      { url: 'ws://test.invalid', subprotocols: [MUD_TELNET_SUBPROTOCOL] },
      new EventBus<MudClientEvents>(),
    );
    client.connect();
    expect(MockWebSocket.instances[0].requestedProtocols).toEqual([MUD_TELNET_SUBPROTOCOL]);
  });

  it('emits client.subprotocol with the server selection on open', () => {
    const bus = new EventBus<MudClientEvents>();
    const seen: string[] = [];
    bus.on('client.subprotocol', (p) => seen.push(p));
    const client = new MudClient(
      { url: 'ws://test.invalid', subprotocols: [MUD_TELNET_SUBPROTOCOL] },
      bus,
    );
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.protocol = MUD_TELNET_SUBPROTOCOL; // server accepted
    sock.onopen?.({});
    expect(seen).toEqual([MUD_TELNET_SUBPROTOCOL]);
  });

  it('emits client.subprotocol with empty string when the server ignores it', () => {
    const bus = new EventBus<MudClientEvents>();
    const seen: string[] = [];
    bus.on('client.subprotocol', (p) => seen.push(p));
    const client = new MudClient(
      { url: 'ws://test.invalid', subprotocols: [MUD_TELNET_SUBPROTOCOL] },
      bus,
    );
    client.connect();
    const sock = MockWebSocket.instances[0];
    // protocol stays '' — server didn't select one
    sock.onopen?.({});
    expect(seen).toEqual(['']);
  });

  it('does not emit client.subprotocol when nothing was advertised', () => {
    const bus = new EventBus<MudClientEvents>();
    const seen: string[] = [];
    bus.on('client.subprotocol', (p) => seen.push(p));
    const client = new MudClient({ url: 'ws://test.invalid' }, bus);
    client.connect();
    MockWebSocket.instances[0].onopen?.({});
    expect(seen).toEqual([]);
  });
});
