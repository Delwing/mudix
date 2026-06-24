// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MudClient } from '../../../src/mud/connection/MudClient';
import { EventBus } from '../../../src/core/EventBus';
import {
  EOR_WILL, EOR_DO,
  SGA_WILL, SGA_DO,
  NEW_ENVIRON_DO, NEW_ENVIRON_WILL, NEW_ENVIRON_WONT,
  OPT_NEW_ENVIRON, NEW_ENVIRON_IS, NEW_ENVIRON_SEND,
  NEW_ENVIRON_VAR, NEW_ENVIRON_USERVAR,
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

  it('accepts DO NEW-ENVIRON with WILL when only plain NEW-ENVIRON is enabled', () => {
    const { sock } = connected({ newEnvironEnabled: true });
    sock.deliver(NEW_ENVIRON_DO);
    const out = sentText(sock);
    expect(out).toContain(NEW_ENVIRON_WILL);
    expect(out).not.toContain(NEW_ENVIRON_WONT);
  });

  // A server's `IAC SB NEW-ENVIRON SEND IAC SE` request — the option parser
  // strips IAC SB/SE and hands the body (option code + command) to the handler.
  const sendRequest = '\xFF\xFA' + OPT_NEW_ENVIRON + NEW_ENVIRON_SEND + '\xFF\xF0';

  it('answers a SEND in MNES mode with VAR-framed core variables only', () => {
    const { sock } = connected({ mnesEnabled: true });
    sock.deliver(NEW_ENVIRON_DO);
    sock.sent.length = 0;
    sock.deliver(sendRequest);
    const out = sentText(sock);
    expect(out).toContain(NEW_ENVIRON_IS + NEW_ENVIRON_VAR + 'CHARSET');
    expect(out).toContain(NEW_ENVIRON_VAR + 'CLIENT_NAME' + '\x01' + 'MUDIX');
    // MNES restricts to the five core vars — no extended capabilities, no USERVAR.
    // (Check unambiguous extended-only vars; "ANSI" now appears inside the
    // TERMINAL_TYPE value "ANSI-TRUECOLOR".)
    expect(out).not.toContain('256_COLORS');
    expect(out).not.toContain('OSC_HYPERLINKS');
    expect(out).not.toContain(NEW_ENVIRON_USERVAR);
  });

  it('answers a SEND in NEW-ENVIRON mode with USERVAR-framed extended variables', () => {
    const { sock } = connected({ newEnvironEnabled: true });
    sock.deliver(NEW_ENVIRON_DO);
    sock.sent.length = 0;
    sock.deliver(sendRequest);
    const out = sentText(sock);
    // Core vars still present, but framed as USERVAR (not VAR).
    expect(out).toContain(NEW_ENVIRON_USERVAR + 'CHARSET');
    expect(out).not.toContain(NEW_ENVIRON_VAR + 'CHARSET');
    // Extended capability set is included.
    expect(out).toContain(NEW_ENVIRON_USERVAR + 'ANSI');
    expect(out).toContain(NEW_ENVIRON_USERVAR + 'TRUECOLOR');
  });

  it('lets MNES take precedence over NEW-ENVIRON when both are enabled', () => {
    const { sock } = connected({ mnesEnabled: true, newEnvironEnabled: true });
    sock.deliver(NEW_ENVIRON_DO);
    sock.sent.length = 0;
    sock.deliver(sendRequest);
    const out = sentText(sock);
    expect(out).toContain(NEW_ENVIRON_VAR + 'CHARSET');
    expect(out).not.toContain('256_COLORS'); // restricted to the MNES core set
    expect(out).not.toContain('OSC_HYPERLINKS');
  });

  it('reports TLS=1 in NEW-ENVIRON mode over a direct wss:// connection', () => {
    const { sock } = connected({ newEnvironEnabled: true, url: 'wss://secure.invalid' });
    sock.deliver(NEW_ENVIRON_DO);
    sock.sent.length = 0;
    sock.deliver(sendRequest);
    // USERVAR 'TLS' VALUE(\x01) '1'
    expect(sentText(sock)).toContain(NEW_ENVIRON_USERVAR + 'TLS' + '\x01' + '1');
  });

  it('reports TLS=0 in NEW-ENVIRON mode when the transport is not secure (proxy mode)', () => {
    // Proxy mode passes secureTransport:false — a wss:// proxy URL only secures
    // the browser↔proxy hop, not the plaintext proxy↔MUD telnet socket.
    const { sock } = connected({ newEnvironEnabled: true, url: 'wss://proxy.invalid', secureTransport: false });
    sock.deliver(NEW_ENVIRON_DO);
    sock.sent.length = 0;
    sock.deliver(sendRequest);
    expect(sentText(sock)).toContain(NEW_ENVIRON_USERVAR + 'TLS' + '\x01' + '0');
  });

  it('emits mnes.negotiated with the active protocol name', () => {
    const seen: string[] = [];
    const { sock, bus } = connected({ newEnvironEnabled: true });
    bus.on('mnes.negotiated', (name) => seen.push(name));
    sock.deliver(NEW_ENVIRON_DO);
    expect(seen).toEqual(['NEW-ENVIRON']);
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
