// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';

// Mudlet exposes the last command-bar input as the global `command` (set in
// AliasUnit::processDataStream). LuaRuntime.setCommand mirrors it; ScriptingEngine
// calls it before alias matching. Here we exercise the LuaRuntime piece directly.
describe('command global — LuaRuntime.setCommand', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('is nil until the first input (matches Mudlet — fresh state)', () => {
    expect(env.run('return command')).toBeNull();
  });

  it('exposes the last input and persists between calls', () => {
    env.rt.setCommand('look');
    expect(env.run('return command')).toBe('look');
    // Persists so the stock "Repeat Last Command" key (send(command)) works.
    expect(env.run('return command')).toBe('look');
    env.rt.setCommand('north');
    expect(env.run('return command')).toBe('north');
  });

  it('round-trips through concatenation (the reported failure case)', () => {
    env.rt.setCommand('kill rat');
    expect(env.run('return "[" .. command .. "]"')).toBe('[kill rat]');
  });
});
