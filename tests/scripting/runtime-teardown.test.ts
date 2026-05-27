// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import { createTestRuntime } from '../createTestRuntime';

// Regression: "connect → disconnect → close profile" used to hang or crash
// inside wasmoon lua_close (LuaRuntime.destroy → lua.global.close).
//
// Root cause: a tempTimer's setTimeout (the only autonomous async caller into
// Lua) fired AFTER the lua_State was closed and called newThread() on a freed
// state → "RuntimeError: ...out of bounds" WASM abort (note the user's truncated
// error tail "...nds" = "out of bou-nds"). The uncaught abort then unwound the
// rest of teardown, leaving subscriptions live → the app hang.
//
// Fix is teardown ordering, not per-method guards: ScriptingEngine.destroy stops
// the timer engine (after sysExitEvent, before the VM closes) so nothing can call
// into a dead state; LuaRuntime.destroy is idempotent and contains a wasmoon
// lua_close abort so it can't unwind the caller. These tests pin that contract at
// the layer the harness exposes (the full ScriptingEngine wiring needs the store).

describe('runtime teardown', () => {
  it('destroy is idempotent (a second lua_close would corrupt the heap)', async () => {
    const env = await createTestRuntime();
    env.rt.destroy();
    expect(() => env.rt.destroy()).not.toThrow();
  });

  it('stopping the timer engine before closing the VM leaves no live callback', async () => {
    vi.useFakeTimers();
    try {
      const env = await createTestRuntime();
      env.run(`tempTimer(0.01, function() echo("tick") end)`);
      // Same order ScriptingEngine.destroy uses: stop the async caller, then close.
      env.api.timers.destroy();
      env.rt.destroy();
      // The (now-cleared) timer must not fire into the closed lua_State.
      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('firing sysExitEvent then destroying completes without throwing', async () => {
    const env = await createTestRuntime();
    env.run(`function MyExit() echo("bye") end`);
    env.run(`registerAnonymousEventHandler("sysExitEvent", "MyExit")`);
    env.rt.emitEvent('sysExitEvent', []);
    expect(() => env.rt.destroy()).not.toThrow();
  });
});
