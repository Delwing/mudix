// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { appendCells, cellsToHtml, columnAfter, CELL_CLASS } from '../../../src/mud/text/cellRender';
import { AnsiAwareBuffer } from '../../../src/mud/text/FormatState';
import { setControlCharacterMode } from '../../../src/mud/text/controlCharacterMode';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('cellsToHtml', () => {
  it('emits plain ASCII unboxed', () => {
    expect(cellsToHtml('hello world', escape)).toBe('hello world');
  });

  it('boxes a non-ASCII (width-1) grapheme into a 1ch cell', () => {
    const html = cellsToHtml('aÜb', escape);
    expect(html).toBe(`a<span class="${CELL_CLASS}" style="width:1ch">Ü</span>b`);
  });

  it('boxes a wide grapheme into a 2ch cell', () => {
    const html = cellsToHtml('x日y', escape);
    expect(html).toBe(`x<span class="${CELL_CLASS}" style="width:2ch">日</span>y`);
  });

  it('keeps a base+combining cluster in a single 1ch cell', () => {
    const html = cellsToHtml('é', escape); // decomposed e + acute
    expect(html).toBe(`<span class="${CELL_CLASS}" style="width:1ch">é</span>`);
  });

  it('escapes boxed grapheme content', () => {
    // not a real case for graphemes, but the escaper must still run
    expect(cellsToHtml('<', escape)).toBe('&lt;');
  });
});

describe('appendCells (DOM)', () => {
  it('appends ASCII as a single text node', () => {
    const div = document.createElement('div');
    appendCells(div, 'plain');
    expect(div.childNodes.length).toBe(1);
    expect(div.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(div.textContent).toBe('plain');
  });

  it('boxes non-ASCII graphemes in fixed-width cell spans', () => {
    const div = document.createElement('div');
    appendCells(div, 'aᚱb'); // runic letter, width 1
    const cells = div.querySelectorAll(`span.${CELL_CLASS}`);
    expect(cells.length).toBe(1);
    expect((cells[0] as HTMLElement).style.width).toBe('1ch');
    expect(cells[0].textContent).toBe('ᚱ');
    expect(div.textContent).toBe('aᚱb');
  });
});

describe('AnsiAwareBuffer.toHtml integration', () => {
  it('boxes wide glyphs while leaving ASCII inline', () => {
    const buf = new AnsiAwareBuffer('hi 日');
    const html = buf.toHtml();
    expect(html).toContain(`<span class="${CELL_CLASS}" style="width:2ch">日</span>`);
    expect(html.startsWith('hi ')).toBe(true);
  });
});

describe('controlCharacterHandling substitution', () => {
  afterEach(() => setControlCharacterMode('asis'));

  it('asis: expands a tab to the next 8-column tab stop as plain spaces', () => {
    // 'a' consumes column 0; the tab then needs 7 spaces to reach column 8.
    expect(cellsToHtml('a\tb', escape, 0, 'asis')).toBe(`a${' '.repeat(7)}b`);
    expect(columnAfter('a\tb', 0, 'asis')).toBe(9);
  });

  it('asis: tab stop math accounts for the starting column', () => {
    expect(cellsToHtml('\t', escape, 3, 'asis')).toBe(' '.repeat(5)); // 3 -> 8 is 5 spaces
  });

  it('asis: other control characters stay invisible (zero-width box), unchanged from before', () => {
    const html = cellsToHtml('a\x07b', escape, 0, 'asis');
    expect(html).toBe(`a<span class="${CELL_CLASS}" style="width:0ch">\x07</span>b`);
  });

  it('picture: maps control codes onto the Unicode Control Pictures block', () => {
    expect(cellsToHtml('\x1b', escape, 0, 'picture')).toBe(`<span class="${CELL_CLASS}" style="width:1ch">␛</span>`); // ESC -> ␛
    expect(cellsToHtml('\x7f', escape, 0, 'picture')).toBe(`<span class="${CELL_CLASS}" style="width:1ch">␡</span>`); // DEL -> ␡
  });

  it('picture: tab still expands to a tab stop, with the picture glyph over the whole width', () => {
    expect(cellsToHtml('\t', escape, 0, 'picture')).toBe(`<span class="${CELL_CLASS}" style="width:8ch">␉</span>`);
  });

  it('oem: maps control codes onto CP437-style glyphs', () => {
    expect(cellsToHtml('\x03', escape, 0, 'oem')).toBe(`<span class="${CELL_CLASS}" style="width:1ch">♥</span>`); // ETX -> heart
  });

  it('oem: tab does NOT get tab-stop spacing, matching Mudlet', () => {
    expect(cellsToHtml('a\tb', escape, 0, 'oem')).toBe(`a<span class="${CELL_CLASS}" style="width:1ch">○</span>b`);
    expect(columnAfter('a\tb', 0, 'oem')).toBe(3);
  });

  it('appendCells returns the ending column and honors the active mode by default', () => {
    setControlCharacterMode('picture');
    const div = document.createElement('div');
    const endCol = appendCells(div, '\t');
    expect(endCol).toBe(8);
    expect(div.querySelector(`span.${CELL_CLASS}`)?.textContent).toBe('␉');
  });

  it('AnsiAwareBuffer.toHtml/toDom pick up the active control-character mode', () => {
    // BEL (not ESC) — avoids the ANSI escape scanner, which treats 0x1b specially.
    setControlCharacterMode('picture');
    const buf = new AnsiAwareBuffer('\x07');
    expect(buf.toHtml()).toBe(`<span class="${CELL_CLASS}" style="width:1ch">␇</span>`);
    const frag = buf.toDom();
    expect((frag.querySelector(`span.${CELL_CLASS}`) as HTMLElement)?.textContent).toBe('␇');
  });
});
