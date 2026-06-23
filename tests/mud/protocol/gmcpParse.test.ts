import { describe, it, expect } from 'vitest';
import { createGmcpStream } from '../../../src/mud/protocol/gmcp';
import { GMCP_COMMAND_CODE } from '../../../src/mud/protocol/constants';

/** Build the subnegotiation body createGmcpStream consumes: the GMCP option
 *  byte (201) followed by the message text. (IAC SB / IAC SE framing is
 *  stripped upstream before the stream sees it.) */
function frame(text: string): string {
  return String.fromCharCode(GMCP_COMMAND_CODE) + text;
}

describe('GMCP payload parsing', () => {
  it('parses a normal message with a JSON body', () => {
    const seen: Array<{ path: string; value: unknown }> = [];
    const stream = createGmcpStream({ onEnvelope: e => seen.push(e) });
    stream(frame('Char.Vitals {"hp":42}'));
    expect(seen).toEqual([{ path: 'Char.Vitals', value: { hp: 42 } }]);
  });

  it('accepts a bodyless message (no space) instead of dropping it', () => {
    // GMCP spec: the data part is optional. The server's canonical Core.Ping
    // reply has no body at all.
    const seen: Array<{ path: string; value: unknown }> = [];
    const stream = createGmcpStream({ onEnvelope: e => seen.push(e) });
    stream(frame('Core.Ping'));
    expect(seen).toEqual([{ path: 'Core.Ping', value: '' }]);
  });

  it('accepts a message with a trailing space but empty body', () => {
    const seen: Array<{ path: string; value: unknown }> = [];
    const stream = createGmcpStream({ onEnvelope: e => seen.push(e) });
    stream(frame('Core.Ping '));
    expect(seen).toEqual([{ path: 'Core.Ping', value: '' }]);
  });

  it('accepts an explicit empty-string body', () => {
    const seen: Array<{ path: string; value: unknown }> = [];
    const stream = createGmcpStream({ onEnvelope: e => seen.push(e) });
    stream(frame('Core.Ping ""'));
    expect(seen).toEqual([{ path: 'Core.Ping', value: '' }]);
  });
});
