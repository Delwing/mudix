import { describe, it, expect } from 'vitest';
import { stripTelnetSequences, createTelnetOptionParser } from '../../../src/mud/protocol/gmcp';

const noopHandler = createTelnetOptionParser(() => {});
const strip = (s: string) => stripTelnetSequences(s, noopHandler);

const IAC = '\xFF', EOR = '\xEF', GA = '\xF9', WILL = '\xFB', ECHO = '\x01', SB = '\xFA', SE = '\xF0';

describe('stripTelnetSequences command lengths', () => {
  it('strips IAC EOR (2-byte) without eating the following byte', () => {
    // The Last Outpost prompt: text, IAC EOR marker, then ESC[K erase.
    const raw = 'By what name do you wish to be known? ' + IAC + EOR + '\x1b[K';
    expect(strip(raw)).toBe('By what name do you wish to be known? \x1b[K');
  });

  it('strips IAC GA (2-byte) without eating the following byte', () => {
    expect(strip('HP:100>' + IAC + GA + 'next')).toBe('HP:100>next');
  });

  it('strips IAC WILL ECHO (3-byte) fully', () => {
    expect(strip('a' + IAC + WILL + ECHO + 'b')).toBe('ab');
  });

  it('strips a subnegotiation and keeps surrounding text', () => {
    expect(strip('x' + IAC + SB + ECHO + 'payload' + IAC + SE + 'y')).toBe('xy');
  });

  it('routes only subnegotiation payloads to the handler', () => {
    const seen: string[] = [];
    const h = createTelnetOptionParser((sub) => seen.push(sub));
    stripTelnetSequences('p' + IAC + EOR + 'q' + IAC + SB + ECHO + 'data' + IAC + SE, h);
    expect(seen).toEqual([ECHO + 'data']);
  });
});
