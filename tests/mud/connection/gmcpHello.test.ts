// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MudClient } from '../../../src/mud/connection/MudClient';
import { EventBus } from '../../../src/core/EventBus';
import { GMCP_WILL, GMCP_DO } from '../../../src/mud/protocol/constants';
import type { MudClientEvents } from '../../../src/mud/events';

/** Minimal stand-in for the browser WebSocket the client opens. Captures every
 *  outbound binary frame so we can assert what was sent. */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(bytes: Uint8Array) { this.sent.push(bytes); }
  close() { this.readyState = MockWebSocket.CLOSED; }

  /** Deliver a Latin-1 byte-string as if it arrived from the server. */
  deliver(byteString: string) {
    const buf = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) buf[i] = byteString.charCodeAt(i) & 0xff;
    this.onmessage?.({ data: buf.buffer });
  }
}

function sentText(sock: MockWebSocket): string {
  return sock.sent.map(b => String.fromCharCode(...b)).join('');
}

describe('GMCP Core.Hello handshake', () => {
  let realWebSocket: unknown;
  let realBeforeUnload: unknown;

  beforeEach(() => {
    realWebSocket = (globalThis as Record<string, unknown>).WebSocket;
    realBeforeUnload = (globalThis as Record<string, unknown>).addEventListener;
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocket as unknown;
    (globalThis as Record<string, unknown>).addEventListener = () => {};
    MockWebSocket.instances = [];
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).WebSocket = realWebSocket;
    (globalThis as Record<string, unknown>).addEventListener = realBeforeUnload;
  });

  function connected() {
    const bus = new EventBus<MudClientEvents>();
    const client = new MudClient({ url: 'ws://test.invalid' }, bus);
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.onopen?.({});
    sock.sent.length = 0; // discard the proactive NAWS WILL
    return { client, sock };
  }

  it('announces Core.Hello + Core.Supports.Set when the server offers GMCP (WILL)', () => {
    const { sock } = connected();
    sock.deliver(GMCP_WILL);
    const out = sentText(sock);
    // Accept GMCP, then announce.
    expect(out).toContain(GMCP_DO);
    expect(out).toContain('Core.Hello');
    expect(out).toContain('"client":"MUDIX"');
    expect(out).toContain('Core.Supports.Set');
  });

  it('also announces when the server requests GMCP (DO)', () => {
    const { sock } = connected();
    sock.deliver(GMCP_DO);
    const out = sentText(sock);
    expect(out).toContain(GMCP_WILL);
    expect(out).toContain('Core.Hello');
  });

  it('announces only once even if the server re-offers GMCP', () => {
    const { sock } = connected();
    sock.deliver(GMCP_WILL);
    sock.deliver(GMCP_WILL);
    const helloCount = sentText(sock).split('Core.Hello').length - 1;
    expect(helloCount).toBe(1);
  });

  it('does not announce when GMCP is disabled', () => {
    const bus = new EventBus<MudClientEvents>();
    const client = new MudClient({ url: 'ws://test.invalid', gmcpEnabled: false }, bus);
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.onopen?.({});
    sock.sent.length = 0;
    sock.deliver(GMCP_WILL);
    expect(sentText(sock)).not.toContain('Core.Hello');
  });
});
