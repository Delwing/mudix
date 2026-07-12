// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';
import type { AnsiAwareBuffer } from '../../src/mud/text/FormatState';
import mudletColors from '../../src/mud/text/mudletColors.json';

// The native color-echo fast paths (decho/cecho/hecho) must be byte-for-byte
// equivalent to Mudlet's Lua xEcho for every input they accept, and must
// transparently fall back for the rest. xEcho itself is untouched by the fast
// path, so it is the oracle: for each string we compare `Xecho(str)` (the
// shadowed global, which may take the fast path) against the corresponding
// `xEcho(<style>, "echo", str)` (the original per-segment Lua path) and require
// identical rendered output.
describe('native color-echo fast paths: parity with xEcho', () => {
  let env: TestRuntime;
  const captured: AnsiAwareBuffer[] = [];

  beforeEach(async () => {
    env = await createTestRuntime();
    captured.length = 0;
    env.session.events.on('message', (line?: AnsiAwareBuffer | string) => {
      if (line && typeof line !== 'string') captured.push(line);
    });
  });
  afterEach(() => env.dispose());

  // Per-character (text, fg, bg) signature of everything a chunk emitted — the
  // rendered result, independent of how segments were split/merged.
  const signature = (chunk: string): Array<[string, string, string]> => {
    captured.length = 0;
    env.run(chunk);
    const out: Array<[string, string, string]> = [];
    for (const buf of captured) {
      for (const seg of buf.getSegments()) {
        const fg = JSON.stringify(seg.state?.foreground ?? null);
        const bg = JSON.stringify(seg.state?.background ?? null);
        for (const ch of seg.text) out.push([ch, fg, bg]);
      }
    }
    return out;
  };

  const luaStr = (s: string) => `[==[${s}]==]`;
  // Assert the shadowed global (`decho`/`cecho`/`hecho`) renders identically to
  // the untouched Lua oracle `xEcho(<style>, "echo", str)`.
  const parity = (fn: string, style: string, str: string) => {
    const fast = signature(`${fn}(${luaStr(str)})`);
    const lua = signature(`xEcho(${luaStr(style)}, "echo", ${luaStr(str)})`);
    expect(fast).toEqual(lua);
  };

  describe('decho', () => {
    const cases: Record<string, string> = {
      'single fg color': '<255,0,0>Hello\n',
      'multiple fg colors': '<255,0,0>Red<0,255,0>Green<0,0,255>Blue\n',
      'per-character rainbow': '<255,0,0>a<0,255,0>b<0,0,255>c<255,255,0>d\n',
      'background color': '<:0,0,255>on blue\n',
      'fg then bg': '<255,0,0>red<:0,0,255>redOnBlue\n',
      'reset mid-string': '<255,0,0>red<r>plain\n',
      'leading plain text': 'plain<255,0,0>red\n',
      'no color at all': 'just plain text\n',
      'repeated same color': '<255,0,0>aa<255,0,0>bb\n',
      'empty string': '',
      // Guard must DECLINE these (→ fall back), still matching xEcho:
      'bold style tag (fallback)': '<255,0,0>red<b>bold</b>\n',
      'out-of-range channel (fallback)': '<300,0,0>bad\n',
      'combined fg:bg (fallback)': '<255,0,0:0,0,255>combined\n',
    };
    for (const [name, str] of Object.entries(cases)) {
      it(`matches xEcho: ${name}`, () => parity('decho', 'Decimal', str));
    }
  });

  describe('cecho', () => {
    const cases: Record<string, string> = {
      'single named color': '<red>Hello\n',
      'multiple named colors': '<red>Red<green>Green<blue>Blue\n',
      'reset via <r>': '<red>red<r>plain\n',
      'reset via <reset>': '<red>red<reset>plain\n',
      'leading plain text': 'plain<green>green\n',
      'no color at all': 'just plain text\n',
      // Guard must DECLINE these (→ fall back), still matching xEcho:
      'style tag (fallback)': '<red>red<b>bold</b>\n',
      'background <:bg> (fallback)': '<:blue>on blue\n',
      'combined <fg:bg> (fallback)': '<red:blue>combined\n',
      'combined <fg,bg> (fallback)': '<red,blue>combined\n',
      'unknown name (fallback)': '<notacolor>text\n',
      'ansi_ name (fallback)': '<ansi_196>text\n',
    };
    for (const [name, str] of Object.entries(cases)) {
      it(`matches xEcho: ${name}`, () => parity('cecho', 'Color', str));
    }

    // Safety net for the JS-palette ↔ Lua color_table sync the fast path relies
    // on: every name cechoToAnsiFast would ACCEPT (bare, present in the JS
    // palette) must render identically to Mudlet's color_table resolution. Any
    // name in the JSON that Mudlet doesn't know (or knows with a different RGB)
    // surfaces here as a mismatch rather than a silent wrong color in the app.
    it('resolves every accepted palette name identically to color_table', () => {
      const names = Object.keys(mudletColors).filter(
        n => /^[a-zA-Z0-9_]+$/.test(n) && n !== 'r' && n !== 'reset' && !/^\/?[biuso]$/.test(n),
      );
      const mismatches: string[] = [];
      for (const name of names) {
        const str = `<${name}>X\n`;
        const fast = signature(`cecho(${luaStr(str)})`);
        const lua = signature(`xEcho("Color", "echo", ${luaStr(str)})`);
        if (JSON.stringify(fast) !== JSON.stringify(lua)) mismatches.push(name);
      }
      expect({ count: mismatches.length, names: mismatches }).toEqual({ count: 0, names: [] });
    });
  });

  describe('hecho', () => {
    const cases: Record<string, string> = {
      'single fg color': '#ff0000Hello\n',
      'multiple fg colors': '#ff0000Red#00ff00Green#0000ffBlue\n',
      'reset via #r': '#ff0000red#rplain\n',
      'leading plain text': 'plain#ff0000red\n',
      'no color at all': 'just plain text\n',
      'hash not a color': 'issue #5 and C#\n',
      // Guard must DECLINE these (→ fall back), still matching xEcho:
      'style tag (fallback)': '#ff0000red#bbold\n',
      'combined fg,bg (fallback)': '#ff0000,0000ffcombined\n',
      'pipe form (fallback)': '|cff0000red\n',
      'colon bg form (fallback)': '#:0000ffonblue\n',
    };
    for (const [name, str] of Object.entries(cases)) {
      it(`matches xEcho: ${name}`, () => parity('hecho', 'Hex', str));
    }
  });

  describe('routing & output', () => {
    it('routes decho(win, str) to the named window, not main', () => {
      env.run('createBuffer("tb")');
      env.run('decho("tb", "<255,0,0>Hi\\n")');
      expect(env.run('return (getCurrentLine("tb"))')).toBe('Hi');
      expect(env.mainOutput.join('')).toBe('');
    });

    it('emits the plain text of a decho line to main', () => {
      env.run('decho("<255,0,0>Hello <0,255,0>World\\n")');
      expect(env.mainOutput).toContain('Hello World');
    });

    it('emits the plain text of a cecho line to main', () => {
      env.run('cecho("<red>Hello <green>World\\n")');
      expect(env.mainOutput).toContain('Hello World');
    });

    it('emits the plain text of a hecho line to main', () => {
      env.run('hecho("#ff0000Hello #00ff00World\\n")');
      expect(env.mainOutput).toContain('Hello World');
    });
  });
});
