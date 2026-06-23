import { describe, it, expect } from 'vitest';
import { parseMnesRequest, encodeMnesIs, selectMnesVars, type MnesVar } from '../../../src/mud/protocol/mnes';
import {
  GMCP_IAC,
  GMCP_SB,
  GMCP_SE,
  OPT_NEW_ENVIRON,
  NEW_ENVIRON_IS,
  NEW_ENVIRON_SEND,
  NEW_ENVIRON_VAR,
  NEW_ENVIRON_VALUE,
  NEW_ENVIRON_ESC,
  NEW_ENVIRON_USERVAR,
} from '../../../src/mud/protocol/constants';

// Build a SEND request body as the telnet option parser hands it to the
// handler: the option code (NEW-ENVIRON, 39) followed by the command byte and
// any VAR/USERVAR entries. IAC SB/SE are stripped upstream, so we omit them.
const sendBody = (...parts: string[]) => OPT_NEW_ENVIRON + NEW_ENVIRON_SEND + parts.join('');

describe('parseMnesRequest', () => {
  it('treats a bare SEND as "send everything"', () => {
    expect(parseMnesRequest(sendBody())).toEqual({ isSend: true, requested: [] });
  });

  it('parses specific requested variable names in order', () => {
    const body = sendBody(
      NEW_ENVIRON_VAR + 'CLIENT_NAME' +
      NEW_ENVIRON_VAR + 'MTTS',
    );
    expect(parseMnesRequest(body)).toEqual({
      isSend: true,
      requested: ['CLIENT_NAME', 'MTTS'],
    });
  });

  it('parses USERVAR entries the same as VAR entries', () => {
    const body = sendBody(NEW_ENVIRON_USERVAR + 'FOO' + NEW_ENVIRON_VAR + 'CHARSET');
    expect(parseMnesRequest(body)).toEqual({
      isSend: true,
      requested: ['FOO', 'CHARSET'],
    });
  });

  it('ignores empty names (a bare VAR marker = request all)', () => {
    expect(parseMnesRequest(sendBody(NEW_ENVIRON_VAR))).toEqual({ isSend: true, requested: [] });
  });

  it('unescapes ESC-prefixed bytes inside a requested name', () => {
    // A name containing a literal VAR byte, escaped per RFC 1572.
    const body = sendBody(NEW_ENVIRON_VAR + 'A' + NEW_ENVIRON_ESC + NEW_ENVIRON_VAR + 'B');
    expect(parseMnesRequest(body)).toEqual({
      isSend: true,
      requested: ['A' + NEW_ENVIRON_VAR + 'B'],
    });
  });

  it('rejects a non-SEND command (e.g. an IS body)', () => {
    expect(parseMnesRequest(OPT_NEW_ENVIRON + NEW_ENVIRON_IS)).toEqual({ isSend: false, requested: [] });
  });

  it('rejects a body whose option byte is not NEW-ENVIRON', () => {
    expect(parseMnesRequest(String.fromCharCode(69) + NEW_ENVIRON_SEND)).toEqual({ isSend: false, requested: [] });
  });
});

describe('encodeMnesIs', () => {
  it('frames an IS reply with VAR/VALUE markers and IAC SB/SE', () => {
    const out = encodeMnesIs([{ name: 'CHARSET', value: 'UTF-8' }]);
    expect(out).toBe(
      GMCP_IAC + GMCP_SB +
      OPT_NEW_ENVIRON + NEW_ENVIRON_IS +
      NEW_ENVIRON_VAR + 'CHARSET' + NEW_ENVIRON_VALUE + 'UTF-8' +
      GMCP_IAC + GMCP_SE,
    );
  });

  it('emits multiple variables in order', () => {
    const out = encodeMnesIs([
      { name: 'CLIENT_NAME', value: 'MUDLET' },
      { name: 'MTTS', value: '269' },
    ]);
    expect(out).toBe(
      GMCP_IAC + GMCP_SB +
      OPT_NEW_ENVIRON + NEW_ENVIRON_IS +
      NEW_ENVIRON_VAR + 'CLIENT_NAME' + NEW_ENVIRON_VALUE + 'MUDLET' +
      NEW_ENVIRON_VAR + 'MTTS' + NEW_ENVIRON_VALUE + '269' +
      GMCP_IAC + GMCP_SE,
    );
  });

  it('escapes control bytes within a value', () => {
    // A value containing IAC (255) must be escaped with ESC.
    const out = encodeMnesIs([{ name: 'X', value: 'a' + GMCP_IAC + 'b' }]);
    expect(out).toContain(NEW_ENVIRON_VALUE + 'a' + NEW_ENVIRON_ESC + GMCP_IAC + 'b');
  });
});

describe('selectMnesVars', () => {
  const available: MnesVar[] = [
    { name: 'CHARSET', value: 'UTF-8' },
    { name: 'CLIENT_NAME', value: 'MUDLET' },
    { name: 'MTTS', value: '269' },
  ];

  it('returns everything for a bare SEND', () => {
    expect(selectMnesVars({ isSend: true, requested: [] }, available)).toEqual(available);
  });

  it('returns only requested known vars, in request order', () => {
    expect(
      selectMnesVars({ isSend: true, requested: ['MTTS', 'CHARSET'] }, available),
    ).toEqual([
      { name: 'MTTS', value: '269' },
      { name: 'CHARSET', value: 'UTF-8' },
    ]);
  });

  it('falls back to everything when no requested name is known', () => {
    expect(
      selectMnesVars({ isSend: true, requested: ['UNKNOWN'] }, available),
    ).toEqual(available);
  });
});
