// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { appendCells, cellsToHtml, CELL_CLASS } from '../../../src/mud/text/cellRender';
import { AnsiAwareBuffer } from '../../../src/mud/text/FormatState';

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
