// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../createTestRuntime';

// Lua tempKey(modifier, keyCode, fn): modifier is a Qt::KeyboardModifier bitmask
// (Ctrl = 0x04000000 = 67108864), keyCode a Qt::Key int (Key_T = 0x54, Key_R = 0x52).
const CTRL = 67108864;

describe('tempKey browser-reserved warning', () => {
  let env: TestRuntime;
  beforeEach(async () => { env = await createTestRuntime(); });
  afterEach(() => env.dispose());

  it('warns when a script binds a browser-owned combo (Ctrl+T)', () => {
    env.run(`tempKey(${CTRL}, 0x54, function() end)`); // Ctrl+T
    const out = env.mainOutput.join('\n');
    expect(out).toContain('Ctrl+T');
    expect(out).toContain("can't reach mudix");
  });

  it('reports the call site (script:line) that registered the key', () => {
    // Run a named chunk so debug.getinfo has a source to report.
    env.rt.run('tempKey(' + CTRL + ', 0x54, function() end)', 'MyMapper');
    const line = env.mainOutput.find(l => l.includes('Ctrl+T'));
    expect(line).toContain('from MyMapper');
  });

  it('does not warn for a page-capturable combo (Ctrl+R)', () => {
    env.run(`tempKey(${CTRL}, 0x52, function() end)`); // Ctrl+R — works while focused
    expect(env.mainOutput.join('\n')).not.toContain('WARN');
  });

  it('warns only once per combo, even if re-registered', () => {
    env.run(`tempKey(${CTRL}, 0x54, function() end)`);
    env.run(`tempKey(${CTRL}, 0x54, function() end)`);
    expect(env.mainOutput.filter(l => l.includes('Ctrl+T'))).toHaveLength(1);
  });
});
