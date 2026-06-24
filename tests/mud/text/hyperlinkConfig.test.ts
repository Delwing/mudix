import { describe, it, expect } from 'vitest';
import {
  expandShorthands,
  deepMerge,
  parseConfigJson,
  normaliseHyperlinkConfig,
  extractQuery,
  parseOsc8Uri,
  HyperlinkPresetRegistry,
} from '../../../src/mud/text/hyperlinkConfig';

describe('expandShorthands', () => {
  it('expands top-level and nested shorthand keys', () => {
    expect(expandShorthands({ s: { c: 'red', b: true, h: { u: true } }, t: 'tip' })).toEqual({
      style: { color: 'red', bold: true, hover: { underline: true } },
      tooltip: 'tip',
    });
  });

  it('leaves unknown keys untouched', () => {
    expect(expandShorthands({ style: { color: 'red' }, custom: 1 })).toEqual({
      style: { color: 'red' },
      custom: 1,
    });
  });

  it('merges a shorthand and its full form with shorthand precedence', () => {
    // Both "s" and "style" present: shorthand value wins on collision.
    expect(expandShorthands({ s: { c: 'red' }, style: { c: 'blue', b: true } })).toEqual({
      style: { color: 'red', bold: true },
    });
  });

  it('expands inside arrays', () => {
    expect(expandShorthands({ m: [{ Strike: 'send:strike' }] })).toEqual({
      menu: [{ Strike: 'send:strike' }],
    });
  });
});

describe('deepMerge', () => {
  it('override wins on scalars, objects merge recursively', () => {
    expect(deepMerge(
      { style: { color: 'red', bold: true }, tooltip: 'a' },
      { style: { color: 'blue' }, tooltip: 'b' },
    )).toEqual({
      style: { color: 'blue', bold: true },
      tooltip: 'b',
    });
  });
});

describe('normaliseHyperlinkConfig / parseConfigJson', () => {
  it('parses base style colours, decorations and underline variants', () => {
    const c = parseConfigJson('{"style":{"color":"red","bg":"#0066ff","bold":true,"underline":"wavy"}}');
    expect(c?.style?.foreground).toEqual({ space: 'rgb', r: 255, g: 0, b: 0 });
    expect(c?.style?.background).toEqual({ space: 'rgb', r: 0, g: 0x66, b: 0xff });
    expect(c?.style?.bold).toBe(true);
    expect(c?.style?.underline).toBe(true);
    expect(c?.style?.underlineStyle).toBe('wavy');
  });

  it('parses underline:true as solid', () => {
    const c = parseConfigJson('{"style":{"underline":true}}');
    expect(c?.style?.underline).toBe(true);
    expect(c?.style?.underlineStyle).toBe('solid');
  });

  it('parses pseudo-class state styles', () => {
    const c = parseConfigJson('{"style":{"color":"blue","hover":{"color":"red"},"visited":{"color":"purple"}}}');
    expect(c?.style?.states?.hover?.foreground).toEqual({ space: 'rgb', r: 255, g: 0, b: 0 });
    expect(c?.style?.states?.visited?.foreground).toEqual({ space: 'rgb', r: 0x80, g: 0, b: 0x80 });
  });

  it('parses a menu array with separators', () => {
    const c = parseConfigJson('{"menu":[{"Strike":"send:strike"},"-",{"Flee":"send:flee"}]}');
    expect(c?.menu).toEqual([
      { label: 'Strike', action: 'send:strike' },
      { separator: true },
      { label: 'Flee', action: 'send:flee' },
    ]);
  });

  it('parses a title (string and object forms)', () => {
    expect(parseConfigJson('{"title":"Lamb Stew"}')?.title).toEqual({ text: 'Lamb Stew' });
    const obj = parseConfigJson('{"title":{"text":"Stew","style":{"color":"#ffd700","bold":true}}}');
    expect(obj?.title?.text).toBe('Stew');
    expect(obj?.title?.style?.bold).toBe(true);
    expect(obj?.title?.style?.foreground).toEqual({ space: 'rgb', r: 0xff, g: 0xd7, b: 0 });
  });

  it('parses tooltip, spoiler and disabled flags', () => {
    const c = parseConfigJson('{"tooltip":"A sword","spoiler":true,"disabled":true}');
    expect(c?.tooltip).toBe('A sword');
    expect(c?.spoiler).toBe(true);
    expect(c?.disabled).toBe(true);
  });

  it('parses visibility settings', () => {
    const c = parseConfigJson('{"visibility":{"action":"conceal","delay":2000,"expire":{"input":true}}}');
    expect(c?.visibility).toMatchObject({ action: 'conceal', delayMs: 2000, expireOnInput: true });
  });

  it('parses selection settings with defaults', () => {
    const c = parseConfigJson('{"selection":{"group":"diff","value":"easy","exclusive":true}}');
    expect(c?.selection).toEqual({ group: 'diff', value: 'easy', exclusive: true, toggle: true });
    // checkbox (non-exclusive) and toggle default
    const cb = parseConfigJson('{"selection":{"group":"buffs","value":"str","exclusive":false}}');
    expect(cb?.selection).toMatchObject({ exclusive: false, toggle: true });
  });

  it('accepts the compact shorthand form end-to-end', () => {
    const c = parseConfigJson('{"s":{"c":"red","b":true},"t":"Shorthand!"}');
    expect(c?.style?.foreground).toEqual({ space: 'rgb', r: 255, g: 0, b: 0 });
    expect(c?.style?.bold).toBe(true);
    expect(c?.tooltip).toBe('Shorthand!');
  });

  it('returns null for invalid JSON', () => {
    expect(parseConfigJson('{not json')).toBeNull();
    expect(parseConfigJson('"a string"')).toBeNull();
  });

  it('normalises an empty object to an empty config', () => {
    expect(normaliseHyperlinkConfig({})).toEqual({});
  });
});

describe('extractQuery', () => {
  it('returns the bare base when there is no query', () => {
    expect(extractQuery('send:look')).toEqual({ base: 'send:look', userPairs: [] });
  });

  it('brace-matches a config JSON value containing & and ; and quotes', () => {
    const q = extractQuery('send:x?config={"tooltip":"a & b; c"}');
    expect(q.base).toBe('send:x');
    expect(q.configJson).toBe('{"tooltip":"a & b; c"}');
  });

  it('separates preset, config and user params', () => {
    const q = extractQuery('send:p?preset=btn&config={"s":{"c":"yellow"}}&id=42');
    expect(q.presetName).toBe('btn');
    expect(q.configJson).toBe('{"s":{"c":"yellow"}}');
    expect(q.userPairs).toEqual(['id=42']);
  });

  it('keeps user query params but drops reserved ones', () => {
    const q = extractQuery('https://x/?id=42&lang=en&config={"a":1}');
    expect(q.userPairs).toEqual(['id=42', 'lang=en']);
    expect(q.configJson).toBe('{"a":1}');
  });
});

describe('parseOsc8Uri', () => {
  it('registers a preset:NAME definition and renders nothing', () => {
    const reg = new HyperlinkPresetRegistry();
    const r = parseOsc8Uri('preset:btn?config={"s":{"bg":"#07f","c":"white","b":true}}', reg);
    expect(r).toEqual({ kind: 'preset', name: 'btn' });
    expect(reg.get('btn')).toEqual({ s: { bg: '#07f', c: 'white', b: true } });
  });

  it('resolves ?preset=NAME against the registry', () => {
    const reg = new HyperlinkPresetRegistry();
    parseOsc8Uri('preset:btn?config={"s":{"bg":"#07f","c":"white","b":true}}', reg);
    const r = parseOsc8Uri('send:go?preset=btn', reg);
    expect(r).toMatchObject({ kind: 'link', command: 'send:go' });
    if (r?.kind === 'link') {
      expect(r.config.style?.bold).toBe(true);
      expect(r.config.style?.background).toEqual({ space: 'rgb', r: 0, g: 0x77, b: 0xff });
    }
  });

  it('deep-merges an override config over the preset (override wins)', () => {
    const reg = new HyperlinkPresetRegistry();
    parseOsc8Uri('preset:btn?config={"s":{"bg":"#07f","c":"white","b":true}}', reg);
    const r = parseOsc8Uri('send:go?preset=btn&config={"s":{"c":"yellow"}}', reg);
    if (r?.kind !== 'link') throw new Error('expected link');
    // overridden colour
    expect(r.config.style?.foreground).toEqual({ space: 'rgb', r: 255, g: 255, b: 0 });
    // inherited from preset
    expect(r.config.style?.bold).toBe(true);
    expect(r.config.style?.background).toEqual({ space: 'rgb', r: 0, g: 0x77, b: 0xff });
  });

  it('strips ALL query params from send:/prompt: commands', () => {
    const reg = new HyperlinkPresetRegistry();
    const r = parseOsc8Uri('send:attack?config={"style":{"color":"red"}}', reg);
    expect(r).toMatchObject({ kind: 'link', command: 'send:attack' });
  });

  it('keeps user params on http links but strips config/preset', () => {
    const reg = new HyperlinkPresetRegistry();
    const r = parseOsc8Uri('https://mudlet.org/?id=42&lang=en&config={"style":{"bold":true}}', reg);
    if (r?.kind !== 'link') throw new Error('expected link');
    expect(r.command).toBe('https://mudlet.org/?id=42&lang=en');
    expect(r.config.style?.bold).toBe(true);
  });

  it('returns null for an empty URI', () => {
    expect(parseOsc8Uri('', new HyperlinkPresetRegistry())).toBeNull();
  });
});
