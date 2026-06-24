# Plan: run Mudlet's busted Lua suite against mudix (Vitest + Playwright)

## Status

**Landed — single path via Playwright.** Real busted 2.3.0 runs in-process inside
wasmoon against the **real running mudix app** in a browser. Driving the actual
app (not a node thin-layer) means the full `ScriptingEngine` — trigger/alias
dispatch, timer pump, overlay/Geyser geometry — is wired exactly as in
production, so there is **one execution path for the whole corpus**.

> The original design proposed two tiers (node Vitest + Playwright). We started
> with the node tier to de-risk "busted-in-wasmoon" (it worked: 4 specs green),
> then **consolidated to a single Playwright path** — the node `createTestRuntime`
> can't fire triggers (it omits the `ScriptingEngine` dispatch wiring), so specs
> using `feedTriggers`/spies could never pass there. The node busted test was
> removed; the vendored busted + spec corpus + `LuaRuntime` bridge are reused
> verbatim by Playwright. The two-tier notes below are kept for history.

Run it: `npm run test:e2e` (Playwright boots `npm run dev:busted` — a
`VITE_BUSTED=1` dev server on port **5174** — and drives Chromium). The default
`npm test` (Vitest) is untouched and never bundles the corpus.

### What exists now

- **Vendored busted** under `src/scripting/lua/busted/` (busted core + luassert +
  say + mediator, plus thin `pl.*`/`system` shims; CLI runner/modules dropped).
  Provenance + omissions in `src/scripting/lua/busted/VENDORED.md`.
- **`runBusted.lua`** — the in-process programmatic runner (no CLI/`os.exit`),
  returns a JSON-able results table (aggregate counts, a `failures[]` list, and a
  `tests[]` record per `it()` — pass, fail, or pending — so the harness can report
  each test individually). It purges the busted ecosystem from `package.loaded` on
  each call so it is re-invokable in a long-lived runtime.
- **`LuaRuntime.ts`** — `VITE_BUSTED`-gated `import.meta.glob` bundles the corpus
  into the `/lua/` VFS namespace, adds `/lua/?.lua;/lua/?/init.lua` to
  `package.path`, and exposes `window.__runBusted(pattern)` in flagged builds.
- **Spec corpus** under `src/scripting/lua/specs/` (verbatim from Mudlet;
  provenance in `specs/SYNCED.md`).
- **`e2e/busted.spec.ts`** + **`e2e/bustedHarness.ts`** + **`playwright.config.ts`**
  + **`.env.busted`** — `bustedHarness.ts` seeds a non-dialing connection into
  `localStorage` (store v20), deep-links `?profile=`, waits for
  `window.__runBusted`, and caches one run per spec. `busted.spec.ts` registers
  **one Playwright `test()` per Mudlet `it()`** (from the committed manifest) so
  IDE runners / JUnit list every test as a first-class, re-runnable node — plus a
  per-spec drift guard and the all-specs scoreboard.
- **`e2e/busted.manifest.json`** + **`e2e/genBustedManifest.ts`** +
  **`playwright.manifest.config.ts`** — the static `{ spec: [it-name, …] }` list
  the per-test suite reads at collection time (the test tree must be known before
  any browser runs, so it can't be discovered live). Regenerate with
  `npm run gen:busted-manifest` after re-syncing specs or adding to `GREEN_SPECS`;
  the drift guard fails until it matches the live `it()` set.

### Scoreboard (current, in-app — all 24 Mudlet specs synced)

**21 of 24 specs are fully green** and asserted in `e2e/busted.spec.ts`; the rest
are the parity backlog. ✓ = asserted green. (`bootProfile`/`reopen` poll a
trivial run until it succeeds, so the test never races the runtime re-creation
during initial mount; the scoreboard re-navigates per spec so mudix's JS console
state can't leak between specs — busted only insulates Lua `_G`.)

| Spec | Result | Note |
|---|---|---|
| StringUtils | ✓ 35/35 | green |
| TableUtils | ✓ 64/64 | green |
| DateTime | ✓ 2/2 | green |
| GMCP | ✓ 14/14 | green |
| Miscallaneous | ✓ 4/4 | `getOS()` now returns Mudlet's `name, version, [type], processor` multi-return |
| TBufferOSC | ✓ 3/3 | green |
| GeyserLabel | ✓ 6/6 | green (real overlay geometry) |
| GeyserButton | ✓ 11/11 | green |
| GeyserStyleSheet | ✓ 26/26 | green |
| GeyserAdjustableContainer | ✓ 6/6 | green |
| KeyBinds | ✓ 10/10 | implemented `getKeyCode` (stores raw Qt key/modifier on temp keys) |
| DebugTools | ✓ 9/9 | profile named "Mudlet self-test" keeps `errorc` spyable (Mudlet's own setup) |
| MudletBusted | ✓ 2/2 | profile id contains "mudlet" so `getMudletHomeDir()` matches |
| Alias | ✓ 3/3 | `exists(id,"alias")` now recognises temp (script-created) aliases |
| Trigger | ✓ 3/3 | `exists(id,"trigger")` now recognises temp triggers |
| Regex | ✓ 21/21 | a non-participating capture group is now `nil` (was `""`) — PCRE2_UNSET → `undefined` → Lua `nil`, matching Mudlet (and JS RegExp) |
| IDManager | ✓ 15/22 (7 pending) | `tempTimer` now validates its delay (arg #1) and raises Mudlet's `bad argument #N type` format, so `registerNamedTimer`'s error reformatting lines up. The 7 pending are upstream `pending()` stubs (async timer tests Mudlet hasn't written) |
| Other | ✗ 43/44 | 1 `deleteMultiline` line-range nuance |
| DB | ✓ 74/74 | green — DB.lua's `_migrate` (column add/delete, `_violations` change) reopens the same DB path mid-run. Two shim fixes: (1) `Luasql.lua` cursors are now `userdata` (via `newproxy`), so `_migrate`'s `type(cur)=="userdata"` PRAGMA-column read fires instead of treating every table as new; (2) the sqlite bridge reuses the live in-memory DB on reconnect to an open path (`SqliteClient.liveId`) instead of stranding it in a fresh `:memory:` and losing the rows |
| InsertTextNewline | ✗ 7/8 | multi-line `insertText`/`cinsertText` now split the current line into new history lines at the cursor (Mudlet #8945) — `Console.insertText`. Last failure is `cecho` after `creplaceLine` in a trigger: needs the trigger-echo output cursor to stay on the replaced line (separate trigger-echo-cursor rework) |
| TextEdit | ✓ 33/33 | green — `createTextEdit` widget as a data-model registry (`TextEditManager`): create/delete, text get/set/clear, the read-only/placeholder/stylesheet/font/font-size/tab-moves-focus properties, `windowType` → "textedit", and the window funcs + Geyser.TextEdit wrapper. (On-screen rendering of the editor pane is a follow-up.) |
| GUIUtils | ✓ 97/98 (1 pending) | green — colour pipeline + named ANSI aliases (snake_case *and* camelCase), `replace`/buffers/`copy2decho`/`copy2html` (partial-as-current-line), `setLabelStyleSheet` return values, `selectAll`, `cecho2string`, reverse `decho2cecho`/`hecho2cecho`. The 1 pending is an upstream `pending()` stub |
| UI | ✗ 59/61 | multi-line `insertText`, delete-error semantics, `windowType("commandline")`, `selectSection` end-of-line clamp, `copy2decho`/`copy2html`, and cursor-based `getTextFormat` all fixed. Remaining 2: nested-trigger capture group, `cecho`-after-`creplaceLine` (both trigger-internals) |
| Mapper | ✓ 22/22 | green — map-menu shape (`getMapMenus` → name→parent) + cascade `removeMapMenu`, `getMapInfo` + `enable/disableMapInfo` returning `(nil,errMsg)`, and per-room border colour/thickness (`set/get/clearRoomBorder*`). (Border data model only; the binary map renderer doesn't paint it yet.) |

Only 4 specs remain, and 3 of them share one root: **the trigger pipeline's
output cursor / line model**.

- **Trigger internals** (Other's `deleteMultiline`, UI's last 2,
  InsertTextNewline's last 1): `feedTriggers` fires trigger callbacks but doesn't
  append the fed lines to `Console.history`, and `cecho` after `creplaceLine`
  doesn't keep the output cursor on the replaced line, and nested-trigger capture
  groups select the wrong group. **Higher risk** — this path backs the
  already-green Trigger/Regex/Alias specs, so it's best done with a human able to
  verify no regressions.
- **DB** (9): DB.lua's live schema migration (`_migrate` via `sqlite_master`
  introspection + `ALTER TABLE`/recreate) loses rows when columns or `_violations`
  change. Isolated (SQL only) but a deep, uncertain debug.

Tackle a cluster, then move each spec into `GREEN_SPECS`.

---

_Original two-tier design notes follow (kept for history; the node tier was
folded into the single Playwright path above)._

This documents how to stand up a two-tier harness that runs Mudlet's own
`busted` Lua test suite against mudix's `LuaRuntime`, so that every failing spec
is a concrete gap in mudix's Mudlet-compatible API.

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
