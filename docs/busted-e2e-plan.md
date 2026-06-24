# Plan: run Mudlet's busted Lua suite against mudix (Vitest + Playwright)

## Status

**Not started (this note).** Design only — no code exists yet. This documents how
to stand up a two-tier harness that runs Mudlet's own `busted` Lua test suite
against mudix's `LuaRuntime`, so that every failing spec is a concrete gap in
mudix's Mudlet-compatible API.

## What Mudlet's "busted test suite" actually is

Not a profile XML — an in-runtime test mechanism (verified against
`Mudlet/Mudlet@development`):

- **24 `*_spec.lua` files** (~330 KB) in `src/mudlet-lua/tests/`, plus a 45-byte
  `.busted` config and a `README.md`. Each spec mirrors a `lua/` companion module.
- Plain [busted](https://github.com/lunarmodules/busted) syntax
  (`describe` / `it` / `assert.*`). Busted + its deps (luassert, say, mediator,
  penlight, term…) are installed via LuaRocks — **not vendored in Mudlet's repo**.
- They run **inside a live Mudlet runtime** via a `runTests <path>` command,
  against *real* globals — these are integration tests, not isolated unit tests.
  The bootstrap (`MudletBusted_spec.lua`) asserts `getMudletHomeDir()` works.
- Crucially, **`busted.runner` is hard-coded to expect its own OS process**, so
  Mudlet re-implemented an *in-process* runner. CI launches a real Mudlet binary
  under xvfb and calls `runTests` (the "Run Busted Tests in Mudlet" GH Action).

References: [tests dir](https://github.com/Mudlet/Mudlet/tree/development/src/mudlet-lua/tests),
[in-client regression tests #2589](https://github.com/Mudlet/Mudlet/issues/2589),
[add busted to CI #3408](https://github.com/Mudlet/Mudlet/issues/3408).

## Where mudix stands

The hard part — a real embedded Lua 5.1 plus an "eval a string, get values back"
surface — already exists and is battle-tested:

- `tests/createTestRuntime.ts` boots a genuine `LuaRuntime` + `ScriptingAPI` over
  a non-connected session, loading the wasmoon + pcre2 WASM from disk under
  `// @vitest-environment node`. ~22 suites already drive Lua this way.
- Interpreter is genuine Lua 5.1 with `os`, `debug`, `coroutine`, `package` /
  `require` all present (`require` resolves against the in-runtime VFS). Busted
  supports 5.1, so the engine itself is not the blocker.

Friction points (the work this plan covers):

| Need | mudix state | Work |
|---|---|---|
| busted + luassert + say + deps | **absent** | Vendor the pure-Lua source into the VFS |
| busted's runner | n/a | **Re-implement programmatically** (same as Mudlet) — never the CLI runner |
| `io.stdout` / `io.write` | `io` is a **VFS shim, no real stdout**; `print` is remapped | Custom output handler collecting into a table |
| `lfs` / `package.path` / discovery | point at the **VFS, not host FS**; `os.exit` is a no-op | Feed spec chunks explicitly; report via return value, not exit code |

## Architecture (chosen path)

Connection is seeded via **localStorage**; the test corpus is seeded via the
**VFS/bundle**. (Store v20 no longer persists scripts in localStorage — they live
in each profile's VFS at `.mudix/profile.json` — so the connection and the corpus
are seeded by different mechanisms.)

```
build flag VITE_BUSTED=1
  └─ LuaRuntime bundles busted/* + *_spec.lua into VFS /lua/  (env-gated import.meta.glob ?raw)
  └─ exposes window.__runBusted(pattern) -> Promise<ResultsJSON>   (flagged build only)

Playwright
  ├─ webServer: npm run dev:busted   (vite with the flag, port 5173)
  ├─ seed connection into localStorage key "mudix_v1" (version 20)
  ├─ goto /?profile=<id>            (App.tsx already honors ?profile=)
  ├─ await window.__runBusted('*')  -> structured pass/fail per spec
  └─ assert + emit JUnit;  DOM sentinel scrape as visual fallback
```

Two tiers:

- **Tier 1 — Vitest/node:** logic specs, fast, runs in CI on every push. Reuses
  the existing `createTestRuntime.ts`.
- **Tier 2 — Playwright:** the render-dependent specs that need real DOM +
  overlay layers (the actual app). Shares the same `runBusted.lua`.

## Components

### 1. Vendor busted — `src/scripting/lua/busted/**` (main effort + main risk)

Busted's CLI runner assumes its own OS process; Mudlet re-implemented an
in-process runner, and so do we.

- Drop the **pure-Lua** modules: `busted`, `busted.core`, `luassert`, `say`,
  `mediator`, `term`, and the **penlight subset** busted's core touches
  (`pl.tablex`, `pl.compat`, `pl.utils` — avoid `pl.dir` / `pl.path` by not using
  file discovery).
- **Shims required** (mudix's environment differs from a real Lua CLI):
  - `io` is a VFS shim with **no real stdout** → the output handler must collect
    into a Lua table, never call `io.write` / `io.stdout`. Use a custom minimal
    handler, not busted's `utfTerminal`.
  - `require('system')` (luasystem, used for timing in recent busted) → tiny shim
    returning `os.clock()` (present).
  - `os.exit` is a no-op in wasmoon → drive busted via its programmatic API. No
    exit-code reliance.
  - `coroutine`, `debug.getinfo` / `traceback`, `package` / `require` are all
    present and VFS-resolved — async, line reporting, module loading work.
- Pin a busted version compatible with **Lua 5.1** (wasmoon is 5.1). Record the
  exact version + upstream commit in `src/scripting/lua/busted/VENDORED.md`.

### 2. Run target — extend `src/scripting/lua/LuaRuntime.ts`

Mirror the existing corpus-bundling pattern (`LuaRuntime.ts:34`,
`MUDLET_LUA_FILES`):

```ts
// env-gated so production builds tree-shake the test corpus out
const BUSTED_FILES = import.meta.env.VITE_BUSTED
  ? import.meta.glob('./busted/**/*.lua', { query: '?raw', import: 'default', eager: true })
  : {};
const SPEC_FILES = import.meta.env.VITE_BUSTED
  ? import.meta.glob('./specs/**/*_spec.lua', { query: '?raw', import: 'default', eager: true })
  : {};
```

Register both into the same VFS `/lua/` namespace the existing `MUDLET_LUA_FILES`
use, and ensure `package.path` includes `/lua/?.lua;/lua/?/init.lua` (the runtime
already seeds a VFS loader into `package.loaders[2]`).

- **Specs corpus** → `src/scripting/lua/specs/`, copied verbatim from Mudlet's
  `src/mudlet-lua/tests/*_spec.lua`. Add a `sync-specs` npm script and a header
  comment recording the upstream commit so drift is visible.

### 3. The runner — `src/scripting/lua/busted/runBusted.lua` + a window hook

Ported from Mudlet's in-process runner. Returns a JSON-able table:

```lua
-- {total, passed, failed, failures = [{spec, desc, message, trace}]}
return function(pattern)
  local busted = require('busted.core')()
  require('busted')(busted)               -- installs describe/it/setup/etc.
  local results = { failures = {} }
  busted.subscribe({'test','end'}, function(elem, _, status)
      results.total = (results.total or 0) + 1
      if status ~= 'success' then
        results.failed = (results.failed or 0) + 1
        results.failures[#results.failures+1] = { desc = elem.name --[[ , ... ]] }
      end
  end)
  for _, path in ipairs(__listSpecs(pattern)) do
      busted.executors.file(path, loadfile(path))   -- register; never shell out
  end
  busted.execute()
  return results
end
```

Expose it to the browser only in the flagged build (in `LuaRuntime.setup()` or a
small `bustedBridge.ts`):

```ts
if (import.meta.env.VITE_BUSTED) {
  (window as any).__runBusted = (pattern = '*') =>
    JSON.parse(this.run(`return yajl.to_string(require('runBusted')('${pattern}'))`));
}
```

Returning **structured JSON via the hook** is the assertion contract
(deterministic, no DOM race). As a secondary visual/fallback the runner also
`cecho`s a sentinel blob (`===BUSTED===\n{json}\n===END===`) into the main
output; Playwright can scrape `.output-area-content .output-msg-content` and parse
between sentinels (DOM caps at 1000 lines — keep it compact).

### 4. Connection seeding (localStorage) — no new app code

`App.tsx:12` already reads `?profile=<id>`:

```ts
await page.addInitScript((id) => {
  localStorage.setItem('mudix_v1', JSON.stringify({
    version: 20,
    state: {
      connections: [{ id, name: 'busted', mode: 'websocket', url: 'ws://127.0.0.1:1/' }],
      client: {}, connectionProfile: {},
    },
  }));
}, 'busted-e2e');
await page.goto('/?profile=busted-e2e');
```

The bogus `url` keeps it from dialing (deep-links open with `withConnect=false`).
The VFS-bundled corpus + window hook do the rest — **no scripts need to be
injected into `profile.json`** because the runner is driven by the hook, not by
`sysLoadEvent`. (Alternative if auto-run on open is wanted: seed one bootstrap
script into `.mudix/profile.json` bound to `sysLoadEvent`. The hook path is more
controllable for CI.)

### 5. Playwright harness — new files

- `package.json` devDep `@playwright/test`; scripts:
  `"dev:busted": "cross-env VITE_BUSTED=1 vite"`, `"test:e2e": "playwright test"`.
  (Use `cross-env` — plain `VITE_BUSTED=1 vite` is bash-only and fails on Windows.)
- `playwright.config.ts`:
  `webServer: { command: 'npm run dev:busted', port: 5173, reuseExistingServer: !process.env.CI }`,
  `reporter: [['junit'], ['html']]`.
- `e2e/busted.spec.ts`: one Playwright test per Lua spec (or one parametrized)
  that calls `window.__runBusted('StringUtils')`, asserts `failed === 0`, and
  surfaces `failures[]` in the assertion message.

## Spec viability — what Tier 2 unlocks

| Tier 1 (node) already viable | **Tier 2 (Playwright) — the payoff** | Hard even in-browser |
|---|---|---|
| StringUtils, TableUtils, Regex, DateTime, GMCP, IDManager, DebugTools, Miscellaneous, Other, DB | **UI, GUIUtils, Geyser\* (Label / Button / StyleSheet / AdjustableContainer), TextEdit, TBufferOSC, InsertTextNewline** | Mapper (needs map data), KeyBinds (needs key dispatch wiring) |

The browser tier is what makes the four `Geyser*` + `UI` (56 KB) + `GUIUtils`
(40 KB) specs meaningful — they assert on real overlay-layer geometry headless
can't produce.

## Sequencing (thin-slice first)

1. **Prove the runner.** Vendor busted + shims, port `runBusted.lua`, get
   `StringUtils_spec` green in a **Vitest/node** test (no browser). De-risks the
   hardest part — in-process busted inside wasmoon — without Playwright in the loop.
2. **Add the run target.** Env-gated glob + `window.__runBusted`.
3. **Add Playwright.** Config + connection seed + one browser test running
   `StringUtils` green.
4. **Expand.** Turn on the Geyser / UI specs; triage failures as a parity-gap
   backlog.

## Risks

- **Busted-in-wasmoon is the real unknown.** Step 1 must succeed before the rest
  is worth building. Fallback if busted internals hard-require luasystem/penlight
  file APIs we can't cheaply shim: a tiny busted-compatible shim implementing just
  `describe` / `it` / `setup` / `teardown` / `assert.*` and running the specs
  against it — most specs only use that surface.
- **Spec drift.** Pin the upstream commit and add a sync script, or specs
  silently diverge from the API they assume.
- **`assert` collisions.** Busted installs a global `assert`; verify the runtime
  hasn't rebound it (step 1).

## On "create profile with XML"

Direct seeding (above) is the chosen runtime path, so XML is not on it. XML keeps
an optional role: keep the corpus + runner **exportable** via the existing
`src/import/mudletXmlExport.ts` so the *same* package can be imported into **real
Mudlet** for cross-validation (does mudix agree with Mudlet on the same specs?).
Add-on, not a dependency.
