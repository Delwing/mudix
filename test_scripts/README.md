# Lua API test scripts

Manual, self-contained smoke tests for mudix's Mudlet-compatible Lua API.
Each file is independent — **paste its full contents into the in-app Lua
console** (or load it as a script) and read the output. A run prints one
`[OK]`/`[FAIL]` line per assertion and a final tally:

```
== Results: N passed, 0 failed ==
```

Everything uses **Mudlet-native globals only** (there is no `mudix.*` table).
Each script wraps itself in a `do … end` block with a local `check()` helper,
so pasting several in a row won't leak globals.

| Script | Covers |
|---|---|
| `buffers.lua`     | `createBuffer`, `copy`, `paste`, `appendBuffer`, `windowType`, `clearWindow` |
| `strings.lua`     | `string.starts/ends/trim/title/cut/split/patternEscape/genNocasePattern`, `f""` |
| `tables.lua`      | `table.size/is_empty/contains/index_of/keys/deepcopy/union/intersection/complement` |
| `colors.lua`      | `cecho2string`, `ansi2string`, `closestColor`, `color_table` |
| `datetime.lua`    | `getEpoch`, `shms`, `getTime` |
| `stopwatches.lua` | `createStopWatch`/`start`/`stop`/`reset`/`getStopWatchTime`/`adjust`/`delete` |
| `events.lua`      | `raiseEvent`, `registerAnonymousEventHandler`, `killAnonymousEventHandler` |
| `text_cursor.lua` | `selectString`/`getSelection`/`deselect`/`moveCursor`/`getLineNumber`/`getColumnNumber` |

The two scripts below are a different style — load them, then call their functions:

| Script | Covers |
|---|---|
| `lua-api-tests.lua`      | The original comprehensive suite. Defines `test_*` functions and `run_all()`; prints `PASS`/`FAIL` via `cecho`. Covers echo/cecho/color, triggers, timers, selection, format, and more. |
| `scrollbox-examples.lua` | Visual **examples** (not assertions): `createScrollBox`/`deleteScrollBox`, nested boxes, `Geyser.ScrollBox`, and the `move`/`resize`/`show`/`hide`/`raiseWindow` verbs. Call `sb_demo_all()` to build them and `sb_cleanup()` to remove them. |

Notes:
- `buffers.lua` and `text_cursor.lua` create **off-screen** buffers (`tb*`/`tc`);
  `buffers.lua` also opens one visible floating miniconsole (`tb_view`).
- These are runtime smoke tests, not a CI suite — the project has no test runner.
- `scrollbox-examples.lua` is interactive/visual (it creates on-screen widgets),
  so it has no `[OK]`/`[FAIL]` output — watch the main window and the boxes.
