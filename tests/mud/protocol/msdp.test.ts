import { describe, it, expect } from 'vitest';
import { createMsdpStream, type MsdpEnvelope } from '../../../src/mud/protocol/msdp';
import {
  OPT_MSDP,
  MSDP_VAR,
  MSDP_VAL,
  MSDP_TABLE_OPEN,
  MSDP_TABLE_CLOSE,
  MSDP_ARRAY_OPEN,
  MSDP_ARRAY_CLOSE,
} from '../../../src/mud/protocol/constants';

// Build a subnegotiation body as createMsdpStream expects it: the option byte
// (MSDP, 69) followed by the MSDP_VAR/VAL grammar. IAC SB/SE are stripped by
// the telnet option parser before the stream sees the data, so we omit them.
const body = (...parts: string[]) => OPT_MSDP + parts.join('');

function collect(data: string): MsdpEnvelope[] {
  const out: MsdpEnvelope[] = [];
  createMsdpStream({ onEnvelope: (e) => out.push(e) })(data);
  return out;
}

describe('createMsdpStream', () => {
  it('parses a single scalar variable', () => {
    expect(collect(body(MSDP_VAR + 'HEALTH' + MSDP_VAL + '5000'))).toEqual([
      { path: 'HEALTH', value: '5000' },
    ]);
  });

  it('parses multiple top-level variables as separate envelopes', () => {
    expect(
      collect(
        body(
          MSDP_VAR + 'HEALTH' + MSDP_VAL + '5000' +
          MSDP_VAR + 'HEALTH_MAX' + MSDP_VAL + '5500',
        ),
      ),
    ).toEqual([
      { path: 'HEALTH', value: '5000' },
      { path: 'HEALTH_MAX', value: '5500' },
    ]);
  });

  it('parses an array value into an ordered list', () => {
    expect(
      collect(
        body(
          MSDP_VAR + 'REPORTABLE_VARIABLES' + MSDP_VAL +
          MSDP_ARRAY_OPEN +
          MSDP_VAL + 'HEALTH' +
          MSDP_VAL + 'HEALTH_MAX' +
          MSDP_ARRAY_CLOSE,
        ),
      ),
    ).toEqual([{ path: 'REPORTABLE_VARIABLES', value: ['HEALTH', 'HEALTH_MAX'] }]);
  });

  it('parses a table value into a string-keyed object', () => {
    expect(
      collect(
        body(
          MSDP_VAR + 'ROOM' + MSDP_VAL +
          MSDP_TABLE_OPEN +
          MSDP_VAR + 'VNUM' + MSDP_VAL + '6008' +
          MSDP_VAR + 'NAME' + MSDP_VAL + 'A forest clearing' +
          MSDP_TABLE_CLOSE,
        ),
      ),
    ).toEqual([
      { path: 'ROOM', value: { VNUM: '6008', NAME: 'A forest clearing' } },
    ]);
  });

  it('parses nested tables and arrays', () => {
    const [env] = collect(
      body(
        MSDP_VAR + 'ROOM' + MSDP_VAL +
        MSDP_TABLE_OPEN +
        MSDP_VAR + 'EXITS' + MSDP_VAL +
        MSDP_TABLE_OPEN +
        MSDP_VAR + 'n' + MSDP_VAL + '6011' +
        MSDP_VAR + 'e' + MSDP_VAL + '6012' +
        MSDP_TABLE_CLOSE +
        MSDP_TABLE_CLOSE,
      ),
    );
    expect(env).toEqual({
      path: 'ROOM',
      value: { EXITS: { n: '6011', e: '6012' } },
    });
  });

  it('decodes UTF-8 in values', () => {
    const bytes = String.fromCharCode(...new TextEncoder().encode('café'));
    expect(collect(body(MSDP_VAR + 'NAME' + MSDP_VAL + bytes))).toEqual([
      { path: 'NAME', value: 'café' },
    ]);
  });

  it('treats a variable with no value byte as empty string', () => {
    expect(collect(body(MSDP_VAR + 'PING'))).toEqual([{ path: 'PING', value: '' }]);
  });

  it('ignores subnegotiations whose option byte is not MSDP', () => {
    // 201 = GMCP; the MSDP stream must not consume it.
    expect(collect(String.fromCharCode(201) + 'Char.Vitals {}')).toEqual([]);
    expect(collect('')).toEqual([]);
  });
});
