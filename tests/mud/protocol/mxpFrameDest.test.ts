// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MxpParser } from '../../../src/mud/protocol/mxp';
import type { BufferSegment } from '../../../src/mud/text/FormatState';

const ESC = '\x1b';
const SECURE = `${ESC}[1z`; // FRAME/DEST are secure-only tags

function makeParser() {
  const sent: string[] = [];
  const parser = new MxpParser({ send: (raw) => sent.push(raw) });
  return { parser, sent };
}
const plainOf = (segs: BufferSegment[]) => segs.map(s => s.text).join('');

describe('MxpParser — FRAME (Mudlet 4.21)', () => {
  it('surfaces a FRAME open command with parsed attributes', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<frame Status internal width=200 height=3c left=10>`);
    expect(r.frames).toEqual([
      { name: 'Status', attrs: { NAME: 'Status', INTERNAL: 'true', WIDTH: '200', HEIGHT: '3c', LEFT: '10' } },
    ]);
    expect(r.plain).toBe(''); // the tag itself renders nothing
  });

  it('surfaces a FRAME close command', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<frame Status action=close>`);
    expect(r.frames).toEqual([{ name: 'Status', attrs: { NAME: 'Status', ACTION: 'close' } }]);
  });

  it('accepts the NAME via attribute as well as positional', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<frame name=Chat floating>`);
    expect(r.frames?.[0]).toEqual({ name: 'Chat', attrs: { NAME: 'Chat', FLOATING: 'true' } });
  });

  it('ignores a nameless FRAME', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<frame>`);
    expect(r.frames).toBeUndefined();
  });

  it('does not act on FRAME in open (non-secure) mode', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`<frame Status>hello`);
    expect(r.frames).toBeUndefined();
    expect(r.plain).toBe('hello');
  });
});

describe('MxpParser — DEST (Mudlet 4.21)', () => {
  it('redirects enclosed text out of the main line into a frame', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}main <dest Status>HP 50</dest> tail`);
    // Redirected text is removed from the main line.
    expect(r.plain).toBe('main  tail');
    expect(r.redirects).toHaveLength(1);
    expect(r.redirects?.[0]).toMatchObject({ frame: 'Status', plain: 'HP 50', eol: false, eof: false });
    expect(plainOf(r.redirects![0].segments)).toBe('HP 50');
  });

  it('honors the EOL and EOF flags', () => {
    const { parser } = makeParser();
    let r = parser.parseLine(`${SECURE}<dest Status eol>x</dest>`);
    expect(r.redirects?.[0]).toMatchObject({ eol: true, eof: false });
    r = parser.parseLine(`${SECURE}<dest Status eof>y</dest>`);
    expect(r.redirects?.[0]).toMatchObject({ eof: true });
  });

  it('resolves the frame name via the NAME attribute', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<dest name=Status eol>z</dest>`);
    expect(r.redirects?.[0]).toMatchObject({ frame: 'Status', plain: 'z', eol: true });
  });

  it('carries an unclosed DEST across lines (one redirect per line, eol at the break)', () => {
    const { parser } = makeParser();
    const r1 = parser.parseLine(`${SECURE}<dest Log>line one`);
    expect(r1.plain).toBe('');
    expect(r1.redirects?.[0]).toMatchObject({ frame: 'Log', plain: 'line one', eol: true });
    // No secure prefix needed on the continuation — the redirect state persists.
    const r2 = parser.parseLine(`line two</dest>after`);
    expect(r2.redirects?.[0]).toMatchObject({ frame: 'Log', plain: 'line two', eol: false });
    expect(r2.plain).toBe('after');
  });

  it('renders a nameless DEST inline (no redirect)', () => {
    const { parser } = makeParser();
    const r = parser.parseLine(`${SECURE}<dest>inline</dest>`);
    expect(r.redirects).toBeUndefined();
    expect(r.plain).toBe('inline');
  });

  it('advertises +frame and +dest in the SUPPORTS reply', () => {
    const { parser, sent } = makeParser();
    parser.parseLine(`${SECURE}<support>`);
    const supports = sent.find(s => s.includes('<SUPPORTS'));
    expect(supports).toContain('+frame');
    expect(supports).toContain('+dest');
    expect(supports).not.toContain('-frame');
  });
});
