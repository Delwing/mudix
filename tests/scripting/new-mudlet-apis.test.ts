// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';
import { parseImageSize } from '../../src/scripting/lua/imageSize';

describe('parseImageSize (getImageSize header parser)', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // signature
    new DataView(png.buffer).setUint32(16, 320); // width
    new DataView(png.buffer).setUint32(20, 200); // height
    expect(parseImageSize(png)).toEqual({ width: 320, height: 200 });
  });

  it('reads GIF dimensions (little-endian)', () => {
    const gif = new Uint8Array(24);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
    const dv = new DataView(gif.buffer);
    dv.setUint16(6, 64, true);
    dv.setUint16(8, 48, true);
    expect(parseImageSize(gif)).toEqual({ width: 64, height: 48 });
  });

  it('reads JPEG dimensions from the SOF0 marker', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,             // SOI
      0xff, 0xe0, 0x00, 0x10, // APP0 segment, length 16
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 14 bytes of APP0 payload
      0xff, 0xc0, 0x00, 0x11, // SOF0, length 17
      0x08, 0x00, 0x90, 0x01, 0x60, // precision, height=144, width=352
    ]);
    expect(parseImageSize(jpeg)).toEqual({ width: 352, height: 144 });
  });

  it('returns null for unrecognised / truncated data', () => {
    expect(parseImageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseImageSize(new Uint8Array(24))).toBeNull();
  });
});

describe('setMergeTables (GMCP merge keys)', () => {
  let rt: TestRuntime;
  beforeAll(async () => { rt = await createTestRuntime(); });
  afterAll(() => rt.dispose());

  it('merges registered keys into the existing gmcp sub-table', () => {
    rt.run('setMergeTables("Char.Status")');
    rt.run('__mudix_set_gmcp("Char.Status", {hp = 10, mp = 5})');
    rt.run('__mudix_set_gmcp("Char.Status", {hp = 20})');
    // mp survives the second update because the key is a merge key.
    expect(rt.run('return gmcp.Char.Status.mp')).toBe(5);
    expect(rt.run('return gmcp.Char.Status.hp')).toBe(20);
    expect(rt.run('return table.contains(mudlet.mergeTables, "Char.Status")')).toBe(true);
  });

  it('replaces (does not merge) keys that were never registered', () => {
    rt.run('__mudix_set_gmcp("Char.Vitals", {hp = 1, mp = 2})');
    rt.run('__mudix_set_gmcp("Char.Vitals", {hp = 9})');
    expect(rt.run('return gmcp.Char.Vitals.mp')).toBeNull();
    expect(rt.run('return gmcp.Char.Vitals.hp')).toBe(9);
  });
});

describe('addMouseEvent / getMouseEvents / removeMouseEvent', () => {
  let rt: TestRuntime;
  beforeAll(async () => { rt = await createTestRuntime(); });
  afterAll(() => rt.dispose());

  it('registers, lists, refuses duplicates, and removes entries', () => {
    expect(rt.run('return addMouseEvent("m1", "onM1", "Do M1", "tip")')).toBe(true);
    // Duplicate uniqueName is refused.
    expect(rt.run('return addMouseEvent("m1", "other")')).toBe(false);
    expect(rt.run('return getMouseEvents().m1["event name"]')).toBe('onM1');
    expect(rt.run('return getMouseEvents().m1["display name"]')).toBe('Do M1');
    expect(rt.run('return getMouseEvents().m1["tooltip text"]')).toBe('tip');
    expect(rt.run('return removeMouseEvent("m1")')).toBe(true);
    expect(rt.run('return getMouseEvents().m1')).toBeNull();
  });
});

describe('addCustomLine', () => {
  let rt: TestRuntime;
  beforeAll(async () => { rt = await createTestRuntime(); });
  afterAll(() => rt.dispose());

  it('adds a point-list custom line that round-trips through getCustomLines', () => {
    rt.run('addRoom(1)');
    expect(rt.run('return addCustomLine(1, {{0,0,0},{5,5,0}}, "north", "dot line", {255,0,0}, true)')).toBe(true);
    expect(rt.run('return getCustomLines(1).north.attributes.style')).toBe('dot line');
    expect(rt.run('return getCustomLines(1).north.attributes.arrow')).toBe(true);
    expect(rt.run('return getCustomLines(1).north.attributes.color.r')).toBe(255);
    // points are 0-indexed in getCustomLines
    expect(rt.run('return getCustomLines(1).north.points[1].x')).toBe(5);
  });

  it('rejects an unknown pen-style name', () => {
    rt.run('addRoom(2)');
    expect(rt.run('return addCustomLine(2, {{0,0,0}}, "north", "squiggle", {0,0,0}, false)')).toBe(false);
  });
});

describe('setWindowWrapIndent / setWindowWrapHangingIndent', () => {
  let rt: TestRuntime;
  beforeAll(async () => { rt = await createTestRuntime(); });
  afterAll(() => rt.dispose());

  it('accepts the main window and rejects an unknown named window', () => {
    expect(rt.run('return setWindowWrapIndent("main", 4)')).toBe(true);
    expect(rt.run('return setWindowWrapHangingIndent("main", 2)')).toBe(true);
    expect(rt.run('return setWindowWrapIndent("nope", 4)')).toBe(false);
  });
});

describe('setLinkStyle / resetLinkStyle', () => {
  let rt: TestRuntime;
  beforeAll(async () => { rt = await createTestRuntime(); });
  afterAll(() => rt.dispose());

  it('applies + clears on an existing label, false on a missing one', () => {
    rt.run('createLabel("lbl1", 0, 0, 50, 20, 1)');
    expect(rt.run('return setLinkStyle("lbl1", "#ff0000", "#00ff00", true)')).toBe(true);
    expect(rt.run('return resetLinkStyle("lbl1")')).toBe(true);
    expect(rt.run('return setLinkStyle("nolabel", "#fff", "#000")')).toBe(false);
  });
});

describe('receiveMSP', () => {
  let rt: TestRuntime;
  beforeAll(async () => { rt = await createTestRuntime(); });
  afterAll(() => rt.dispose());

  it('parses an MSP payload (true) and ignores plain text (false)', () => {
    expect(rt.run('return receiveMSP("!!SOUND(test.wav V=80)")')).toBe(true);
    expect(rt.run('return receiveMSP("just some text")')).toBe(false);
  });
});
