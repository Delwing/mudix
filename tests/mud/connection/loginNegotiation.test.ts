// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MudClient } from '../../../src/mud/connection/MudClient';
import { EventBus } from '../../../src/core/EventBus';
import {
  EOR_WILL, EOR_DO,
  SGA_WILL, SGA_DO,
  NEW_ENVIRON_DO, NEW_ENVIRON_WILL, NEW_ENVIRON_WONT,
} from '../../../src/mud/protocol/constants';
import type { MudClientEvents } from '../../../src/mud/events';

/** Minimal stand-in for the browser WebSocket, capturing outbound frames. */
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(public url: string) { MockWebSocket.instances.push(this); }
  send(bytes: Uint8Array) { this.sent.push(bytes); }
  close() { this.readyState = MockWebSocket.CLOSED; }

  deliver(byteString: string) {
    const buf = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) buf[i] = byteString.charCodeAt(i) & 0xff;
    this.onmessage?.({ data: buf.buffer });
  }
}

function sentText(sock: MockWebSocket): string {
  return sock.sent.map(b => String.fromCharCode(...b)).join('');
}

describe('login-time telnet negotiation replies', () => {
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

  function connected(opts: Record<string, unknown> = {}) {
    const bus = new EventBus<MudClientEvents>();
    const client = new MudClient({ url: 'ws://test.invalid', ...opts }, bus);
    client.connect();
    const sock = MockWebSocket.instances[0];
    sock.onopen?.({});
    sock.sent.length = 0; // discard the proactive NAWS WILL
    return { client, sock, bus };
  }

  const GMCP = String.fromCharCode(201);
  const gmcpFrame = (body: string) => '\xFF\xFA' + GMCP + body + '\xFF\xF0';

  it('accepts WILL EOR with DO EOR (enables prompt markers)', () => {
    const { sock } = connected();
    sock.deliver(EOR_WILL);
    expect(sentText(sock)).toContain(EOR_DO);
  });

  it('accepts WILL SGA with DO SGA', () => {
    const { sock } = connected();
    sock.deliver(SGA_WILL);
    expect(sentText(sock)).toContain(SGA_DO);
  });

  it('declines DO NEW-ENVIRON with WONT when MNES is disabled', () => {
    const { sock } = connected({ mnesEnabled: false });
    sock.deliver(NEW_ENVIRON_DO);
    const out = sentText(sock);
    expect(out).toContain(NEW_ENVIRON_WONT);
    expect(out).not.toContain(NEW_ENVIRON_WILL);
  });

  it('accepts DO NEW-ENVIRON with WILL when MNES is enabled', () => {
    const { sock } = connected({ mnesEnabled: true });
    sock.deliver(NEW_ENVIRON_DO);
    const out = sentText(sock);
    expect(out).toContain(NEW_ENVIRON_WILL);
    expect(out).not.toContain(NEW_ENVIRON_WONT);
  });

  it('emits charLogin.request on Char.Login.Default (no auto-reply)', () => {
    const { sock, bus } = connected();
    let methods: string[] | undefined;
    bus.on('charLogin.request', (m) => { methods = m; });
    sock.deliver(gmcpFrame('Char.Login.Default {"type":["password-credentials"]}'));
    expect(methods).toEqual(['password-credentials']);
    // The client no longer auto-answers — the UI drives the reply now.
    expect(sentText(sock)).not.toContain('Char.Login.Credentials');
  });

  it('sendCharLoginCredentials sends account + password', () => {
    const { client, sock } = connected();
    client.sendCharLoginCredentials('myaccount', 'secret');
    expect(sentText(sock)).toContain('Char.Login.Credentials {"account":"myaccount","password":"secret"}');
  });

  it('sendCharLoginCredentials with no account sends the empty fallback', () => {
    const { client, sock } = connected();
    client.sendCharLoginCredentials();
    expect(sentText(sock)).toContain('Char.Login.Credentials {}');
  });

  it('emits charLogin.result on Char.Login.Result', () => {
    const { sock, bus } = connected();
    const results: { success: boolean; message?: string }[] = [];
    bus.on('charLogin.result', (r) => { results.push(r); });
    sock.deliver(gmcpFrame('Char.Login.Result {"success":false,"message":"Invalid credentials"}'));
    sock.deliver(gmcpFrame('Char.Login.Result {"success":true}'));
    expect(results).toEqual([
      { success: false, message: 'Invalid credentials' },
      { success: true, message: undefined },
    ]);
  });

  it('answers all three in a single combined negotiation frame', () => {
    // Mirrors The Last Outpost's opening burst.
    const { sock } = connected({ mnesEnabled: false });
    sock.deliver(SGA_WILL + EOR_WILL + NEW_ENVIRON_DO);
    const out = sentText(sock);
    expect(out).toContain(SGA_DO);
    expect(out).toContain(EOR_DO);
    expect(out).toContain(NEW_ENVIRON_WONT);
  });
});
