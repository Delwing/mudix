// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { scanEscape } from '../../../src/mud/text/ansiEscapes';
import { AnsiAwareBuffer } from '../../../src/mud/text/FormatState';
import { MxpParser } from '../../../src/mud/protocol/mxp';

const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;

describe('scanEscape', () => {
  it('classifies an SGR CSI and reports its final byte + params', () => {
    const s = `${ESC}[1;31mX`;
    const esc = scanEscape(s, 0);
    expect(esc).toMatchObject({ kind: 'csi', finalByte: 'm', params: '1;31', end: 7 });
  });

  it('classifies a non-SGR CSI (cursor move) without consuming following text', () => {
    const s = `${ESC}[2JX`;
    const esc = scanEscape(s, 0);
    expect(esc).toMatchObject({ kind: 'csi', finalByte: 'J', end: 4 });
  });

  it('classifies an OSC 8 sequence terminated by BEL', () => {
    const s = `${ESC}]8;;https://example.com${BEL}link`;
    const esc = scanEscape(s, 0);
    expect(esc.kind).toBe('osc');
    expect(esc.oscPayload).toBe('8;;https://example.com');
    expect(s.slice(esc.end)).toBe('link');
  });

  it('classifies an OSC sequence terminated by ST (ESC \\)', () => {
    const s = `${ESC}]0;window title${ST}rest`;
    const esc = scanEscape(s, 0);
    expect(esc.kind).toBe('osc');
    expect(s.slice(esc.end)).toBe('rest');
  });

  it('reports an unterminated sequence as incomplete', () => {
    const esc = scanEscape(`${ESC}[1;31`, 0);
    expect(esc.kind).toBe('incomplete');
  });

  it('classifies a short escape (charset designation)', () => {
    const s = `${ESC}(BX`;
    const esc = scanEscape(s, 0);
    expect(esc).toMatchObject({ kind: 'esc', end: 3 });
  });
});

describe('AnsiAwareBuffer escape handling', () => {
  it('still parses SGR colour as before', () => {
    const buf = new AnsiAwareBuffer(`${ESC}[31mred${ESC}[0m`);
    expect(buf.text).toBe('red');
    expect(buf.getStateAt(0)?.foreground).toBeTruthy();
  });

  it('ignores OSC 8 hyperlink sequences instead of printing them', () => {
    // The reported bug: OSC 8 link wrappers leaked onto the screen verbatim.
    const buf = new AnsiAwareBuffer(`${ESC}]8;;https://example.com${ST}click here${ESC}]8;;${ST}`);
    expect(buf.text).toBe('click here');
  });

  it('ignores a non-SGR CSI without eating the text after it', () => {
    const buf = new AnsiAwareBuffer(`before${ESC}[2Jafter`);
    expect(buf.text).toBe('beforeafter');
  });

  it('does not run a cursor move into a later SGR (old indexOf("m") bug)', () => {
    // ESC[H has no 'm'; the old parser searched forward and swallowed up to the
    // next SGR's 'm', corrupting the line. Now each sequence ends at its own final.
    const buf = new AnsiAwareBuffer(`${ESC}[Hhome ${ESC}[32mgreen`);
    expect(buf.text).toBe('home green');
  });

  it('drops a truncated escape at end of line rather than rendering it', () => {
    const buf = new AnsiAwareBuffer(`text${ESC}[1;3`);
    expect(buf.text).toBe('text');
  });
});

describe('MxpParser escape handling', () => {
  function parse(line: string) {
    const parser = new MxpParser({ send: () => {} });
    return parser.parseLine(line);
  }

  it('ignores OSC sequences instead of leaking them as literal text', () => {
    const r = parse(`${ESC}]8;;https://example.com${ST}shop${ESC}]8;;${ST}`);
    expect(r.plain).toBe('shop');
  });

  it('still applies SGR and consumes other CSI finals', () => {
    const r = parse(`${ESC}[31mred${ESC}[2Jmore`);
    expect(r.plain).toBe('redmore');
  });
});
