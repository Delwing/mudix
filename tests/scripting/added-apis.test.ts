// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';
import { TriggerEngine } from '../../src/mud/triggers/TriggerEngine';

// tempLineTrigger's counting logic lives in TriggerEngine.addTempLine, which is
// exercised here directly (the dispatch pipeline that drives processTemp from
// network input lives in ScriptingEngine and isn't wired into createTestRuntime).
describe('tempLineTrigger — TriggerEngine.addTempLine', () => {
  it('fires on `howMany` lines starting `from` lines ahead, then self-expires', () => {
    const te = new TriggerEngine();
    const fired: string[] = [];
    te.addTempLine(1, 2, (m) => fired.push(m[0]));
    te.processTemp('line-1');
    te.processTemp('line-2');
    te.processTemp('line-3'); // already expired
    expect(fired).toEqual(['line-1', 'line-2']);
  });

  it('skips `from - 1` lines before the first fire', () => {
    const te = new TriggerEngine();
    const fired: string[] = [];
    te.addTempLine(3, 1, (m) => fired.push(m[0]));
    te.processTemp('a');
    te.processTemp('b');
    te.processTemp('c'); // from=3 → third line fires
    te.processTemp('d');
    expect(fired).toEqual(['c']);
  });

  it('does not tick on the line it was created on (created mid-handler)', () => {
    const te = new TriggerEngine();
    const fired: string[] = [];
    te.addTemp('spawn', () => {
      te.addTempLine(1, 1, (m) => fired.push(m[0]));
    }, 'substring');
    te.processTemp('spawn'); // creation line — the new line trigger must skip it
    te.processTemp('next');  // from=1 → fires here
    te.processTemp('after');
    expect(fired).toEqual(['next']);
  });

  it('early disposal cancels remaining fires', () => {
    const te = new TriggerEngine();
    const fired: string[] = [];
    const kill = te.addTempLine(1, 5, (m) => fired.push(m[0]));
    te.processTemp('1');
    kill();
    te.processTemp('2');
    expect(fired).toEqual(['1']);
  });
});

describe('tempLineTrigger — Lua binding', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('registers from Lua and runs the code on the next line', () => {
    env.run('tempLineTrigger(1, 1, [[echo("FIRED\\n")]])');
    env.api.triggers.processTemp('a line of output');
    expect(env.mainOutput.join('')).toContain('FIRED');
  });

  it('stops after `howMany` fires', () => {
    env.run('tempLineTrigger(1, 2, [[echo("X\\n")]])');
    env.api.triggers.processTemp('1');
    env.api.triggers.processTemp('2');
    env.api.triggers.processTemp('3');
    const xs = env.mainOutput.join('').match(/X/g) ?? [];
    expect(xs.length).toBe(2);
  });
});

describe('echoPopup / insertPopup / setPopup', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('echoPopup writes its text to the target window', () => {
    env.run('createBuffer("tb"); echoPopup("tb", "MENU\\n", {"look"}, {"Look here"})');
    expect(env.run('return (getCurrentLine("tb"))')).toBe('MENU');
  });

  it('insertPopup inserts its text at the cursor', () => {
    env.run('createBuffer("tb"); cecho("tb", "ABCD\\n"); moveCursor("tb", 2, 0)');
    env.run('insertPopup("tb", "XX", {"look"}, {"Look"})');
    expect(env.run('return (getCurrentLine("tb"))')).toBe('ABXXCD');
  });

  it('setPopup returns false with no selection and true once a selection exists', () => {
    env.run('createBuffer("tb"); cecho("tb", "<red>Hello<reset>\\n")');
    expect(env.run('return (setPopup("tb", {"look"}, {"Look"}))')).toBe(false);
    env.run('selectCurrentLine("tb")');
    expect(env.run('return (setPopup("tb", {"look"}, {"Look"}))')).toBe(true);
  });
});

describe('wrapLine', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('returns true for an in-range line and false out of range', () => {
    env.run('createBuffer("tb"); cecho("tb", "Hello\\n")');
    // one line at index 0 (getLineCount returns the 0-indexed last line number)
    expect(env.run('return (getLineCount("tb"))')).toBe(0);
    expect(env.run('return (wrapLine("tb", 0))')).toBe(true);
    expect(env.run('return (wrapLine("tb", 0))')).toBe(true); // idempotent re-render
    expect(env.run('return (wrapLine("tb", 5))')).toBe(false);
    expect(env.run('return (wrapLine("tb", -1))')).toBe(false);
  });

  it('targets the last line via getLineCount and does not throw', () => {
    env.run('createBuffer("tb"); cecho("tb", "one\\n"); cecho("tb", "two\\n")');
    expect(() => env.run('wrapLine("tb", getLineCount("tb"))')).not.toThrow();
  });
});

// No socket is wired in the test runtime, so the send/feed paths exercise the
// full Lua → ScriptingAPI → MudSession chain and confirm the "not connected"
// branch returns cleanly rather than throwing.
describe('sendMSDP / sendSocket / feedTelnet / disconnect — wiring', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('sendMSDP / sendSocket return false when disconnected', () => {
    expect(env.run('return (sendMSDP("ROOM"))')).toBe(false);
    expect(env.run('return (sendMSDP("REPORT", "HP", "MP"))')).toBe(false);
    expect(env.run('return (sendSocket("\\255\\250\\240"))')).toBe(false);
  });

  it('feedTelnet and disconnect are callable without a connection', () => {
    expect(() => env.run('feedTelnet("hi\\n"); disconnect()')).not.toThrow();
  });
});

describe('getTimestamp', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('returns an "hh:mm:ss.zzz" string for an in-range (1-based) line', () => {
    env.run('createBuffer("tb"); cecho("tb", "hi\\n")');
    const ts = env.run('return (getTimestamp("tb", 1))');
    expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('returns nil for an out-of-range line or a missing window', () => {
    env.run('createBuffer("tb"); cecho("tb", "hi\\n")');
    expect(env.run('return (getTimestamp("tb", 99))')).toBe(null);
    expect(env.run('return (getTimestamp("nope", 1))')).toBe(null);
  });
});

describe('getLabelSizeHint', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  // No DOM in the node harness, so getSizeHint falls back to the label's
  // configured geometry — which is exactly what we asserted createLabel set.
  it('returns the label width and height', () => {
    env.run('createLabel("L", 0, 0, 120, 40, false)');
    expect(env.run('local w, h = getLabelSizeHint("L"); return w')).toBe(120);
    expect(env.run('local w, h = getLabelSizeHint("L"); return h')).toBe(40);
  });

  it('returns nil for a non-existent label', () => {
    expect(env.run('return (getLabelSizeHint("nope"))')).toBe(null);
  });
});

// No map panel is mounted in the test runtime, so no MapControl is registered.
// These confirm the Lua → ScriptingAPI → WindowManager chain is wired and
// degrades cleanly (Mudlet's "no map" path) rather than throwing.
describe('getMapZoom / setMapZoom / updateMap — wiring', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('report no-map and do not throw with no panel open', () => {
    expect(env.run('return (getMapZoom())')).toBe(false);
    // A valid zoom (>= 3.0) still reports false because no panel is mounted.
    expect(env.run('return (setMapZoom(5))')).toBe(false);
    expect(() => env.run('updateMap()')).not.toThrow();
  });

  it('rejects a zoom below the Mudlet minimum of 3.0', () => {
    expect(env.run('return (setMapZoom(2))')).toBe(false);
    expect(env.run('return (setMapZoom(0))')).toBe(false);
  });
});

describe('connectToServer — port validation', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('rejects out-of-range ports before attempting a connection', () => {
    expect(env.run('return (connectToServer("example.org", 0))')).toBe(false);
    expect(env.run('return (connectToServer("example.org", 99999))')).toBe(false);
  });
});

// setMsdpValue is the bridge from a decoded MSDP variable into the Lua `msdp`
// global (mirrors setGmcpValue → gmcp). The receive pipeline's parsing is
// covered in tests/mud/protocol/msdp.test.ts; here we confirm the value lands
// in the expected Lua shape.
describe('msdp global — setMsdpValue', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('exposes an empty msdp table before any packet', () => {
    expect(env.run('return type(msdp)')).toBe('table');
  });

  it('writes a scalar variable to the flat top-level key', () => {
    env.rt.setMsdpValue('HEALTH', '5000');
    expect(env.run('return msdp.HEALTH')).toBe('5000');
  });

  it('writes nested table values reachable by key', () => {
    env.rt.setMsdpValue('ROOM', { VNUM: '6008', EXITS: { n: '6011' } });
    expect(env.run('return msdp.ROOM.VNUM')).toBe('6008');
    expect(env.run('return msdp.ROOM.EXITS.n')).toBe('6011');
  });

  it('replaces the whole top-level key on update (no sibling merge)', () => {
    env.rt.setMsdpValue('ROOM', { VNUM: '1' });
    env.rt.setMsdpValue('ROOM', { NAME: 'elsewhere' });
    expect(env.run('return msdp.ROOM.VNUM')).toBe(null);
    expect(env.run('return msdp.ROOM.NAME')).toBe('elsewhere');
  });
});

// Mapper data completeness: room/area user-data, grid mode, getAreaTableSwap
// and resetRoomArea. All are pure MapStore operations; these drive the real
// Lua globals end-to-end (wasmoon → MapStore → back) on an empty in-memory map.
describe('room user data — getAllRoomUserData / clearRoomUserData(Item) / resetRoomArea', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('round-trips and clears all room user data', () => {
    env.run('addRoom(10)');
    env.run('setRoomUserData(10, "name", "Square")');
    env.run('setRoomUserData(10, "terrain", "grass")');
    expect(env.run('return (getAllRoomUserData(10)).name')).toBe('Square');
    expect(env.run('return (getAllRoomUserData(10)).terrain')).toBe('grass');
    // clear one item
    expect(env.run('return (clearRoomUserDataItem(10, "terrain"))')).toBe(true);
    expect(env.run('return (getAllRoomUserData(10)).terrain')).toBe(null);
    // clear the rest
    expect(env.run('return (clearRoomUserData(10))')).toBe(true);
    expect(env.run('return next(getAllRoomUserData(10))')).toBe(null);
    // a second clear finds nothing
    expect(env.run('return (clearRoomUserData(10))')).toBe(false);
  });

  it('reports the miss for a non-existent room', () => {
    expect(env.run('return (getAllRoomUserData(999))')).toBe(false);
    expect(env.run('return (clearRoomUserData(999))')).toBe(false);
    expect(env.run('return (clearRoomUserDataItem(999, "x"))')).toBe(false);
    expect(env.run('return (resetRoomArea(999))')).toBe(false);
  });

  it('resetRoomArea moves a room to the void area (-1)', () => {
    env.run('addRoom(20, 5)');
    expect(env.run('return getRoomArea(20)')).toBe(5);
    expect(env.run('return (resetRoomArea(20))')).toBe(true);
    expect(env.run('return getRoomArea(20)')).toBe(-1);
  });
});

describe('area user data + grid mode + getAreaTableSwap', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('round-trips and clears area user data', () => {
    const aid = env.run('return (addAreaName("Forest"))') as number;
    expect(typeof aid).toBe('number');
    expect(env.run(`return (setAreaUserData(${aid}, "music", "birds.mp3"))`)).toBe(true);
    expect(env.run(`return (getAreaUserData(${aid}, "music"))`)).toBe('birds.mp3');
    expect(env.run(`return (getAllAreaUserData(${aid})).music`)).toBe('birds.mp3');
    expect(env.run(`return (clearAreaUserDataItem(${aid}, "music"))`)).toBe(true);
    expect(env.run(`return (getAreaUserData(${aid}, "music"))`)).toBe(false);
    expect(env.run(`return (clearAreaUserData(${aid}))`)).toBe(false); // already empty
  });

  it('reports the miss for a non-existent area', () => {
    expect(env.run('return (getAreaUserData(999, "k"))')).toBe(false);
    expect(env.run('return (getAllAreaUserData(999))')).toBe(false);
    expect(env.run('return (setAreaUserData(999, "k", "v"))')).toBe(false);
    expect(env.run('return (getGridMode(999))')).toBe(false);
    expect(env.run('return (setGridMode(999, true))')).toBe(false);
  });

  it('toggles grid mode on an area', () => {
    const aid = env.run('return (addAreaName("Cave"))') as number;
    expect(env.run(`return (getGridMode(${aid}))`)).toBe(false);
    expect(env.run(`return (setGridMode(${aid}, true))`)).toBe(true);
    expect(env.run(`return (getGridMode(${aid}))`)).toBe(true);
  });

  it('getAreaTableSwap keys areas by integer id', () => {
    const aid = env.run('return (addAreaName("Plains"))') as number;
    expect(env.run(`return (getAreaTableSwap())[${aid}]`)).toBe('Plains');
  });
});
