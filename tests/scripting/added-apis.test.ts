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
