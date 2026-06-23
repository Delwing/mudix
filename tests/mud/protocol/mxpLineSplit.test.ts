// @vitest-environment node
//
// Regression coverage for the Discworld "lost newlines" bug: Discworld (and
// other LPMud MXP servers) send a whole room — description, exits, contents,
// prompt — as ONE network line, delimiting the visual lines with MXP `<BR>`
// tags rather than `\n`. The MXP parser turns each `<BR>` into an embedded `\n`,
// and splitMxpResultLines must break that single parsed result back into one
// entry per visual line (with link offsets remapped) so each renders on its own
// instead of being collapsed into a single run-together line.
import { describe, it, expect } from 'vitest';
import { MxpParser, splitMxpResultLines } from '../../../src/mud/protocol/mxp';

const ESC = '\x1b';
const SECURE = `${ESC}[1z`;

function makeParser() {
  return new MxpParser({ send: () => {} });
}

describe('splitMxpResultLines', () => {
  it('leaves a single-line result untouched (shares the arrays)', () => {
    const parser = makeParser();
    const r = parser.parseLine('Just one line of text.');
    const parts = splitMxpResultLines(r);
    expect(parts).toHaveLength(1);
    expect(parts[0].plain).toBe('Just one line of text.');
    expect(parts[0].segments).toBe(r.segments);
    expect(parts[0].links).toBe(r.links);
  });

  it('splits a <BR>-delimited room into one entry per visual line', () => {
    const parser = makeParser();
    const r = parser.parseLine(
      'You are in a room.<BR>There are two obvious exits: north and south.<BR>A cat is here.',
    );
    // Sanity: the parser produced embedded newlines from the <BR> tags.
    expect(r.plain).toBe(
      'You are in a room.\nThere are two obvious exits: north and south.\nA cat is here.',
    );

    const parts = splitMxpResultLines(r);
    expect(parts.map(p => p.plain)).toEqual([
      'You are in a room.',
      'There are two obvious exits: north and south.',
      'A cat is here.',
    ]);
    // No subline carries a stray '\n', and the segment text reassembles the line.
    for (const part of parts) {
      expect(part.segments.map(s => s.text).join('')).toBe(part.plain);
      expect(part.plain.includes('\n')).toBe(false);
    }
  });

  it('renders an empty visual line for consecutive <BR> tags', () => {
    const parser = makeParser();
    const r = parser.parseLine('top<BR><BR>bottom');
    const parts = splitMxpResultLines(r);
    expect(parts.map(p => p.plain)).toEqual(['top', '', 'bottom']);
    expect(parts[1].segments).toEqual([]); // genuine blank line
  });

  it('remaps each link onto the subline it lands on', () => {
    const parser = makeParser();
    // Two <BR>-separated lines; the second carries clickable <Exit> links.
    const r = parser.parseLine(
      `${SECURE}This is the room.<BR>Exits: <send>north</send> and <send>south</send>.`,
    );
    const parts = splitMxpResultLines(r);
    expect(parts).toHaveLength(2);
    expect(parts[0].links).toHaveLength(0);
    expect(parts[1].links).toHaveLength(2);

    // Offsets must be relative to the subline's own plain text, not the
    // combined parse result — "north" and "south" within "Exits: north and south."
    const line2 = parts[1].plain;
    for (const link of parts[1].links) {
      const word = line2.slice(link.start, link.end);
      expect(['north', 'south']).toContain(word);
    }
  });
});
