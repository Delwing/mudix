import { describe, it, expect } from 'vitest';
import { connectionSecureTransport, type MudConnection } from '../../src/storage/schema';

const conn = (c: Partial<MudConnection>): MudConnection => ({ id: 'x', name: 'x', ...c });

describe('connectionSecureTransport', () => {
  it('is true for a direct wss:// websocket connection', () => {
    expect(connectionSecureTransport(conn({ mode: 'websocket', url: 'wss://mud.example.com/ws' }))).toBe(true);
  });

  it('is false for a direct ws:// websocket connection', () => {
    expect(connectionSecureTransport(conn({ mode: 'websocket', url: 'ws://mud.example.com/ws' }))).toBe(false);
  });

  it('treats an undefined mode as websocket (backward compat)', () => {
    expect(connectionSecureTransport(conn({ url: 'wss://mud.example.com/ws' }))).toBe(true);
    expect(connectionSecureTransport(conn({ url: 'ws://mud.example.com/ws' }))).toBe(false);
  });

  it('is always false in proxy (mud) mode, even with a wss:// proxy URL', () => {
    // The proxy reaches the MUD over plaintext TCP, so the game-facing link is
    // never TLS regardless of how the browser reaches the proxy.
    expect(connectionSecureTransport(conn({
      mode: 'mud', host: 'aardmud.org', port: 23, proxyUrl: 'wss://proxy.example.com',
    }))).toBe(false);
  });

  it('is false for a websocket connection with no URL', () => {
    expect(connectionSecureTransport(conn({ mode: 'websocket' }))).toBe(false);
  });
});
