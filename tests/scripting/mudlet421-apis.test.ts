// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';
import { AnsiAwareBuffer } from '../../src/mud/text/FormatState';

// Coverage for the Mudlet 4.21 parity additions: getBorderColor, the memory
// introspection pair, the warning-emitting no-op stubs for inapplicable APIs
// (Discord / IRC / spawn / spell-check), and the bundled pure-Lua lpeg (LuLPeg).
// permExactMatchTrigger's CRUD lives in ScriptingEngine (not wired into this
// harness), so here we only assert its Lua binding is callable without error.
describe('Mudlet 4.21 API additions', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  describe('getBorderColor', () => {
    it('returns the setBorderColor override', () => {
      const v = env.run(`setBorderColor(10, 20, 30)
        local r, g, b = getBorderColor()
        return r .. "," .. g .. "," .. b`);
      expect(v).toBe('10,20,30');
    });

    it('returns three numeric channels by default', () => {
      const n = env.run('return select("#", getBorderColor())');
      expect(n).toBe(3);
      expect(env.run('return type((getBorderColor()))')).toBe('number');
    });
  });

  describe('memory introspection', () => {
    it('getProcessMemoryUsage returns a number', () => {
      expect(typeof env.run('return getProcessMemoryUsage()')).toBe('number');
    });

    it('getSubsystemMemoryStats returns a table with the documented keys', () => {
      expect(env.run('return type(getSubsystemMemoryStats())')).toBe('table');
      // mapRooms is 0 on a fresh (empty) map; the key must still be present.
      expect(env.run('return getSubsystemMemoryStats().mapRooms')).toBe(0);
      // luaMemoryKb is folded in by the Bridge wrapper via collectgarbage.
      expect(env.run('return getSubsystemMemoryStats().luaMemoryKb > 0')).toBe(true);
    });
  });

  describe('no-op stubs for inapplicable APIs', () => {
    it('Discord getters are callable and return nil', () => {
      // Lua nil round-trips to JS as null through doStringSync.
      expect(env.run('return getDiscordDetail()')).toBeNull();
    });
    it('spawn returns false', () => {
      expect(env.run('return spawn("ls")')).toBe(false);
    });
    it('spellCheckWord treats every word as correct', () => {
      expect(env.run('return spellCheckWord("qwerty")')).toBe(true);
    });
    it('spellSuggestWord / getDictionaryWordList return empty tables', () => {
      expect(env.run('return #spellSuggestWord("qwerty")')).toBe(0);
      expect(env.run('return type(getDictionaryWordList())')).toBe('table');
    });
    it('IRC getters return the documented defaults', () => {
      expect(env.run('return type(getIrcChannels())')).toBe('table');
      expect(env.run('return getIrcNick()')).toBe('');
    });
  });

  describe('MMCP stubs', () => {
    it('mudlet.supports.mmcp is false', () => {
      expect(env.run('return mudlet.supports.mmcp')).toBe(false);
    });
    it('mmcp.* is a table of callable no-ops', () => {
      expect(env.run('return type(mmcp)')).toBe('table');
      expect(env.run('return mmcp.chatAll("hi")')).toBe(false);
      expect(env.run('return type(mmcp.getClientFlags())')).toBe('table');
      expect(env.run('return mmcp.chatName()')).toBe('');
    });
  });

  describe('permExactMatchTrigger binding', () => {
    it('is callable and returns a number (flatten/split path works)', () => {
      // -1 here because ScriptingEngine's CRUD callback isn't wired in this
      // harness; the point is the Bridge.lua flatten + JS split runs cleanly.
      expect(typeof env.run('return permExactMatchTrigger("t", "", {"exact"}, "")')).toBe('number');
    });
  });

  describe('MXP FRAME/DEST consumer (ScriptingAPI)', () => {
    it('mxpFrame opens a mini-console and ACTION=close removes it', () => {
      env.api.mxpFrame('StatusBar', { NAME: 'StatusBar', WIDTH: '200', HEIGHT: '80', LEFT: '0', TOP: '0' });
      expect(env.session.windows.isMiniConsole('StatusBar')).toBe(true);
      env.api.mxpFrame('StatusBar', { NAME: 'StatusBar', ACTION: 'close' });
      expect(env.session.windows.isMiniConsole('StatusBar')).toBe(false);
    });

    it('mxpWriteToFrame: false for a missing frame, true once the frame exists', () => {
      expect(env.api.mxpWriteToFrame('Nope', new AnsiAwareBuffer('hi'), false)).toBe(false);
      env.api.mxpFrame('F', { NAME: 'F' });
      expect(env.api.mxpWriteToFrame('F', new AnsiAwareBuffer('hi'), false)).toBe(true);
      expect(env.api.mxpWriteToFrame('F', new AnsiAwareBuffer('clear-me'), true)).toBe(true); // eof clears
    });
  });

  describe('lpeg (LuLPeg)', () => {
    it('is published as a global', () => {
      expect(env.run('return type(lpeg)')).toBe('table');
    });
    it('matches a repetition pattern', () => {
      expect(env.run('return lpeg.match(lpeg.P("a")^1, "aaa")')).toBe(4); // position after match
    });
    it('supports captures and grammars', () => {
      const v = env.run(`local digit = lpeg.R("09")
        local ws = lpeg.S(" ")^0
        local list = lpeg.Ct((lpeg.C(digit^1) * ws)^0)
        local t = lpeg.match(list, "1 22 333")
        return t[1] .. "," .. t[2] .. "," .. t[3]`);
      expect(v).toBe('1,22,333');
    });
  });
});
