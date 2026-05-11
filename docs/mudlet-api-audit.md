# Mudlet API Parity Audit

Full per-function comparison of the Lua API exposed by **mudix** (`src/scripting/lua/LuaRuntime.ts` + `src/scripting/lua/Bridge.lua` + `src/scripting/ScriptingAPI.ts`) against the canonical Mudlet API (`src/lua-function-list.json` and `src/TLuaInterpreter*.cpp` in the Mudlet repo).

Scope: ~200 native bindings. Pure-Lua wrappers in bundled `mudlet-lua/` (cecho, decho, hecho, xEcho, etc.) are **out of scope** — they're verbatim Mudlet code; only the underlying primitives they call are audited.

## Totals

| Severity | Count | Meaning |
|---|---|---|
| OK | 53 | No meaningful discrepancy. |
| minor | 4 | Same calls accepted, edge-case behavior or return shape differs. |
| major | 0 | Wrong arg count/order, missing required arg, broken overload, wrong return type. |
| missing | 0 | Declared as a stub but Mudlet has real behavior scripts depend on. |
| fixed | 127 | Top-priority items #1–#28, 5 earlier follow-ups (`setFgColor`/`setBgColor` channel validation + alpha, `deselect` window arg, `replace` keepcolor, `echoLink` useCurrentFormat), and 40 more minor parity items: 8 mapper writes now return bool, 3 mapper reads use Mudlet miss-shapes (`-1` / `(false, errMsg)`), `showWindow` / `setUserWindowTitle` / `setBackgroundColor` / `deleteLabel` / `setLabelToolTip` return bool, `clearUserWindow()` no-arg clears main, full HTTP family returns `(true, url)`, and `customHTTP` gained the optional `file` arg. **Pass 2 (minor → fixed × 20):** `printError` accepts `showStackTrace`/`haltExecution`, `getSelection` returns `nil, msg`, `getCurrentLine` / `windowType` / `getBackgroundColor` report `nil, errMsg` on missing window, `getRoomArea` / `getRoomEnv` return `-1` on miss, `getMapUserData` and `getRoomUserData` (with `fullErr`) emit `(false, errMsg)`, `enableScript` / `disableScript` raise on miss, `uninstallPackage` returns `nil` on miss, `raiseEvent` / `send` return `true`, `sendGMCP` gained the optional `what` arg, `openWebPage` returns bool, `openMapWidget` accepts the `(x, y)` form and returns `true`, `openUserWindow` returns `true`, `createRoomID` accepts the `minimum` arg, `exists` accepts numeric id lookup, and `expandAlias`'s default `echo` is now `false` (Mudlet shape). **Pass 3 (minor → fixed × 20):** `setFontSize` / `getFontSize` / `setFont` / `getFont` and `getUserWindowSize` shape misses as `(nil, errMsg)`, `setBorderColor` validates 0–255 channels and ignores alpha, `removeCommandLineMenuEvent` returns `(false, errMsg)` on miss, `getModuleSync` / `setModulePriority` / `getModulePriority` / `enableModuleSync` / `disableModuleSync` raise on unknown module, `installModule` keeps the bool but `reloadModule` drops it (Mudlet shape), `getRoomChar` returns `(nil, errMsg)` on missing room, `setLabelCursor` accepts string shape names directly, `createLabel` rejects non-boolean `fillBackground`/`clickThrough`, `setCustomEnvColor` validates 0–255 channels, `addMapEvent`/`removeMapEvent` drop the extra bool return, `getMainWindowSize` reports the inner console area (viewport minus borders), `saveProfile` returns `(nil, errMsg)` on synchronous failure and raises `sysSaveProfileError` for async flush failures, `isPrompt` follows the cursor (Mudlet's per-line `TBuffer.isPrompt`), `debugc`/`errorc` accept Mudlet's single-content shape (`errorc` also accepts the optional `debugInfo`), and `getNetworkLatency` caches the most recent measurement and returns `-1` until one exists. **Pass 4 (minor → fixed × 3, minor → OK × 5):** `setWindowWrap` now requires a `name` arg (Mudlet shape — no more no-arg shorthand; non-string raises a bad-argument error), `setLabelStyleSheet` parses full QSS rulesets and emits scoped `<style>` rules for pseudo-state selectors (`QLabel:hover` / `QLabel::pressed` / `QLabel:!hover` etc.), and `getCustomEnvColorTable` was added as Mudlet's canonical accessor (mudix's `getCustomEnvColor(id)` kept as a one-shot helper). Verified: `installPackage` and `registerAnonymousEventHandler` are overridden by bundled `Other.lua` at load time (it ships in `mudlet-lua/` and is loaded via `LuaGlobal.lua`'s file list). Pre-existing fixes confirmed: `moveCursorEnd` already sets the column cursor on the last line, `getRoomCoordinates` returns 3 values via the Bridge.lua wrapper, and `getModuleInfo` returns `nil` (not an empty table) on unknown modules. |

---

## Top priorities (major + missing, by impact)

The discrepancies most likely to silently break ported Mudlet scripts.

### 1. Off-by-one in line-number APIs (cursor) — RESOLVED

Mudlet's `getLineCount`, `getLastLineNumber`, `getLineNumber` all return **0-indexed line index** (i.e. `size - 1`); mudix returns 1-indexed counts. Any script doing `for i = 1, getLineCount() do` will read one line past the end (or skip the first line, depending on intent).

- `getLineNumber([win])` — mudix `cursor + 1`, Mudlet `mUserCursor.y()` (0-indexed). `Console.ts:138`, `ScriptingAPI.ts:715`.
- `getLineCount([win])` — mudix `history.length`, Mudlet `size - 1`. `Console.ts:139`.
- `getLastLineNumber([win])` — mudix `history.length`, Mudlet `size - 1` (and `-1` for missing window). `ScriptingAPI.ts:723`.

### 2. Kill APIs take numeric tempIDs, but Mudlet takes name strings — RESOLVED

Mudlet's `killTimer/killAlias/killTrigger/killKey` accept the **name string** of a permanent item. mudix only accepts the numeric ID returned by `tempTimer/tempAlias/...`. Calling `killTimer("myTimer")` is a silent no-op.

- `killTimer`, `killAlias`, `killTrigger`, `killKey` — `LuaRuntime.ts:816,828,863,881`.

### 3. `permScript` / `permRegexTrigger` / `setScript` return UUID strings, not ints — RESOLVED

Mudlet returns a numeric `id` on success. mudix returns a UUID string from the Zustand store. Code doing `if id > 0 then …` works (string is truthy) but anything storing the id as a key in a numeric table breaks.

- `LuaRuntime.ts:697-714`, `ScriptingAPI.ts:399-409`.

### 4. `tempKey` requires modifier; numeric keycodes don't translate — RESOLVED

- Mudlet: `tempKey([modifier,] keyCode, fn)` — modifier optional; `keyCode` is a Qt::Key int.
- mudix: requires 3 args; passes the key through `String(key)`. Numeric Qt::Key codes get stringified instead of mapped to a `KeyboardEvent.key` value, so `tempKey(0x4000000, 0x01000004, fn)` (Ctrl+Enter) won't match. `LuaRuntime.ts:870-880`.

### 5. `tempTrigger` does regex matching, not substring — RESOLVED

Mudlet's `tempTrigger` is **substring-match** (a literal contains check). `tempRegexTrigger` is regex. mudix routes both to `TriggerEngine.addTemp`, which compiles the pattern as PCRE. Scripts written for `tempTrigger` will fail when their substring contains regex metacharacters (`(`, `[`, `?`, etc.).

- `LuaRuntime.ts:840-862`, shared primitive.

### 6. `selectCaptureGroup` — RESOLVED

- **Numeric form**: mudix re-runs `selectString(text, 1)` — picks the **first** occurrence of the captured substring on the line, not the actual capture position. If the captured text appears more than once, this selects the wrong span.
- **Named form**: returns `-1` (TODO). `LuaRuntime.ts:914-922`.

### 7. `clearMapUserData` clears a single key (Mudlet clears the whole map dict) — RESOLVED

Mudlet: `clearMapUserData()` (no args, clears entire map user-data table) — Mudlet's `clearMapUserDataItem(key)` clears one key. mudix's `clearMapUserData(key)` is doing the **`Item`** behavior under the wrong name. Scripts calling `clearMapUserData()` with no args silently clear `""`.

- `LuaRuntime.ts:459`, `ScriptingAPI.ts → MapStore.clearMapUserData`.

### 8. `setExit` / `setExitStub` / `setDoor` reject string directions — RESOLVED

Mudlet accepts both string (`"north"`, `"n"`) and integer (1–12) directions. mudix only accepts integers. Most user scripts use strings. `LuaRuntime.ts:464-473`.

**Fix:** added `parseDirection()` helper in `MapStore.ts` that normalizes either form to the 1-12 index. `setExit` / `setExitStub` / `setDoor` now accept `number | string`. `setDoor` additionally normalizes the direction key to the canonical field name when the input maps to a stock direction; arbitrary special-exit cmd strings still pass through unchanged.

### 9. Area APIs reject name lookups — RESOLVED

`setRoomArea`, `getRoomAreaName`, `setAreaName`, `deleteArea`: Mudlet accepts either area-ID number **or** area-name string. mudix only accepts numeric IDs. `LuaRuntime.ts:437,532-533,530`.

**Fix:** `MapStore` got a private `resolveAreaId(idOrName)` helper. `setRoomArea` now also accepts an array of room IDs and an area-ID-or-name; `getRoomAreaName` is bidirectional (number→name, name→number); `setAreaName` and `deleteArea` accept either form. `setRoomArea` and `setAreaName` validate the lookup and return `false` (or `(false, errMsg)` for `setAreaName`) on miss instead of silently no-op'ing.

### 10. `addRoom` drops the `areaID` arg — RESOLVED

Mudlet: `addRoom(roomID, areaID)`. mudix: `addRoom(id)` only — the room is created but never assigned to its target area. `LuaRuntime.ts:429`.

**Fix:** `MapStore.addRoom(id, areaId?)` now accepts an optional area ID. When provided, the room is created in that area, the area is created if missing, and the room is registered on the area's `rooms` list (so `getAreaRooms` reflects it immediately). The Lua binding forwards the second arg.

### 11. `getMapEvents` uses wrong field names — RESOLVED

Mudlet shape: `{[uniqueName] = {["event name"]=, ["parent"]=, ["display name"]=, ["arguments"]={...}}}`. mudix returns `{event=, parent=, display=, args=}`. `LuaRuntime.ts:497-508`.

**Fix:** moved the table-build into Bridge.lua's `getMapEvents()` wrapper so the per-entry keys are real Lua strings (`["event name"]`, `["parent"]`, `["display name"]`, `["arguments"]`) and the `arguments` array is rebuilt 1-indexed. JS exposes the raw entries via `__getMapEvents`.

### 12. `addAreaName` returns existing ID on duplicate — RESOLVED

Mudlet returns `(false, errMsg)` on duplicate or empty name. mudix returns the existing ID, masking the conflict from script logic. `LuaRuntime.ts:529`.

**Fix:** `MapStore.addAreaName` now returns `{ ok: false, err }` on dup/empty and a numeric id on success. JS exposes `__addAreaName`; a Bridge.lua wrapper unpacks the result into Mudlet's `(false, errMsg)` multi-return. `setAreaName` got the same treatment for new-name conflicts.

### 13. `addCommandLineMenuEvent` arg semantics wrong — RESOLVED

Mudlet: `addCommandLineMenuEvent([cmdLineName,] menuLabel, eventName)` — **no `displayName` arg**. mudix treats the 4-arg form as `(cmdLineName, uniqueName, event, displayName)` and the 3-arg form as `(uniqueName, event, displayName)`. The `displayName` slot doesn't exist in Mudlet; menu entries display the `menuLabel` directly. `LuaRuntime.ts:607-627`.

**Fix:** the binding now treats the 2-arg form as `(menuLabel, eventName)` and the 3-arg form as `(cmdLineName, menuLabel, eventName)` — `cmdLineName` is dropped (single command bar) and `menuLabel` doubles as both the unique key and the display string (matching Mudlet, which has no separate display slot).

### 14. `echoPopup` no-window form is broken — RESOLVED

Bridge.lua's wrapper does not auto-detect the no-window form. Calling `echoPopup(text, {cmds}, {hints})` (3 args) ends up with `text` interpreted as a window name and `{cmds}` interpreted as the popup text. Mudlet's C++ uses argc-based detection. `Bridge.lua:302`.

**Fix:** the Bridge.lua wrapper now uses `select('#', ...)` argc-based detection. 3-arg → `(text, cmds, hints)`. 4-arg disambiguates by `type(arg2) == 'table'` (`(text, cmds, hints, useFmt)` vs `(window, text, cmds, hints)`). 5-arg → full form with window and fmt.

### 15. `getMudletVersion("table")` returns 3 values, not 4 — RESOLVED

Mudlet returns `(major, minor, revision, build)`. mudix returns `(major, minor, revision)` only — drops `build`. `Bridge.lua:106`.

**Fix:** the `"table"` branch in Bridge.lua now returns four values: `MAJOR, MINOR, REVISION, BUILD`.

### 16. `setBorderSizes` missing 2-arg and 3-arg overloads — RESOLVED

Mudlet supports 1, 2, 3, or 4 args (uniform / vertical-horizontal / top-horizontal-bottom / TRBL). mudix supports only 1 and 4. `LuaRuntime.ts:1021-1027`.

**Fix:** `ScriptingAPI.setBorderSizes` now case-splits on argc to implement the full CSS-shorthand semantics (1=uniform, 2=V/H, 3=top/H/bottom, 4=TRBL). The Lua binding forwards only the args actually passed, so missing slots stay `undefined` and the overload selection works.

### 17. `selectSection` returns nothing; no validation — RESOLVED

Mudlet returns boolean and rejects negative `from`. mudix records the selection unconditionally and returns `undefined`. Scripts using `if not selectSection(...)` always see `nil`. `ScriptingAPI.ts:594`.

**Fix:** `selectSection` now validates `from >= 0`, requires a finite non-negative length, and verifies the resolved buffer exists before recording the selection. Returns `true` on success, `false` otherwise. The Lua binding forwards the bool.

### 18. `moveCursor` returns nothing; ignores `x` outside trigger context — RESOLVED

- Returns `undefined` (Mudlet returns boolean).
- Outside trigger processing, `x` is ignored — only the line component is honored. `ScriptingAPI.ts:816-823`.

**Fix:** unified the cursor model end-to-end. The matching line is now pushed into `mainConsole.history` via `Console.appendLine(buffer)` *before* triggers fire — exactly how Mudlet's `TBuffer` already contains the matching line at trigger-fire time. The `lineBuffer` / `lineBufferLineIndex` / `cursorOnLineBuffer` machinery is gone; the cursor is just `(Console.cursorIdx, Console.cursorCol)` and works the same way during trigger processing and outside. `getLineNumber` / `getLineCount` / `getLastLineNumber` / `getCurrentLine` / `getColumnNumber` / `selectString` / `insertText` / `replace` / `deleteLine` / `moveCursor` all read/write Console directly. As a bonus side-effect, `Console.history` now contains MUD output (it didn't before — it only held script echoes), so line-count APIs report the actual MUD buffer size and DOM eviction works for MUD lines too. The only remaining trigger-local flag is `inTriggerProcessing`, used solely to decide whether mutations should auto-rerender (deferred until post-trigger render) or echoes should defer.

### 19. `moveCursorUp`/`Down` ignore `lines` and `keepHorizontal` overloads — RESOLVED

Mudlet (via mudlet-lua/lua/GUIUtils.lua): `moveCursorUp([win,] [lines=1,] [keepHorizontal])`. mudix accepts only `windowName`. Calling `moveCursorUp(5)` is interpreted as `windowName="5"` and silently fails. `LuaRuntime.ts:773-774`.

**Fix:** the Lua bindings disambiguate the leading arg by type — string is the window name; number is the lines count (window defaults to main). `Console.moveUp/moveDown` take both `lines` and `keepHorizontal` flags. `keepHorizontal=true` preserves the column across the vertical move; `false` (default) resets it to 0. Stale columns are lazily clamped to the destination line's length on read. Both return `true` when the cursor actually moved.

### 20. `getLines` table is 0-indexed (Mudlet is 1-indexed) — RESOLVED

JS array crosses the wasmoon boundary as a 0-indexed Lua table. `ipairs(t)` skips the first entry. Other primitives use a Bridge.lua `rebuildJsArray` wrapper for this; `getLines` doesn't. `LuaRuntime.ts:769-772`.

**Fix:** raw bridge moved to `__getLines`; the Bridge.lua `getLines` wrapper now passes the result through `rebuildJsArray`, returning a 1-indexed sequence so `ipairs` walks all entries.

### 21. `createMiniConsole` parent is silently dropped — RESOLVED

Mudlet's 6-arg form `(parent, name, x, y, w, h)` nests the miniconsole inside a userwindow. mudix accepts the parent arg but treats it as `main`. `ScriptingAPI.ts:849-866`.

**Fix:** `ScriptWindowData` now carries an optional `parent` field. `createMiniConsole` forwards the parent into `WindowManager.open` and `FloatingWindowLayer` portals parent-anchored windows into `manager.getViewport(parent)` via a separate `floating-window-root--nested` portal (`position: absolute`), so the script's (x, y) are interpreted relative to the parent userwindow and the miniconsole follows the parent on move/resize. `registerViewport` now triggers a notify so a miniconsole created before the parent panel mounts re-portals once the parent's viewport registers.

### 22. `raiseLabel` / `lowerLabel` — wrong function name — RESOLVED

Mudlet exposes `raiseWindow(labelName)` / `lowerWindow(labelName)` for both labels and userwindows. There is no `raiseLabel` / `lowerLabel` in Mudlet. Scripts written against Mudlet docs will get `attempt to call a nil value`. `LuaRuntime.ts:337-342`.

**Fix:** added `raiseWindow(name)` / `lowerWindow(name)` Lua globals that route to the label manager when `name` is a label and to `WindowManager.bringToFront` / `sendToBack` when it's a userwindow. `WindowManager.sendToBack` computes a fresh below-min `zIndex` so successive lower calls maintain relative ordering. `raiseLabel` / `lowerLabel` are kept as aliases so existing mudix-only scripts don't break.

### 23. `setLabelClickCallback` doesn't pass an event table — RESOLVED

Mudlet's click callback receives a `{button, x, y, …}` event table. mudix calls the callback with no args. Vararg trailing args are also dropped. Old cb id leaks in Lua registry on rebind. `LuaRuntime.ts:310-314`, `Bridge.lua:268-273`.

**Fix:** `LabelManager` callbacks now receive a `{button, x, y, globalX, globalY, alt, ctrl, shift, meta}` event table built from the React `MouseEvent` (with DOM-button → Mudlet-button-int translation). The Lua side dispatches via a new `__mudix_dispatch_cb_arg(id)` that reads `__mudix_cb_arg`, so the `dispatchCbWithArg` JS helper can hand the table through. The Bridge.lua wrapper bakes trailing varargs into the registered closure, treats `fn == nil` as "clear" (passes cb id 0), and the JS-side `setLabelCb` helper tracks the prior cb id per (label, slot) and calls `__mudix_unregister_cb` on rebind so `__mudix_cb` doesn't leak.

### 24. `sendCmdLine` semantics inverted — RESOLVED

- Mudlet: stages text into the command bar (`setPlainText` + `selectAll`); does **not** submit.
- mudix: immediately sends the text to the MUD via `api.send`. `LuaRuntime.ts:901-903`.

**Fix:** `sendCmdLine([cmdLineName,] text)` now emits `script.setcmd` (the same path `printCmdLine` uses) so the text replaces the command bar's contents without sending. The App-side handler additionally focuses and `select()`s the input (matches Mudlet's trailing `selectAll`). The `cmdLineName` arg is accepted for API parity and ignored — mudix has a single command bar.

### 25. Missing real label callbacks (browser supports them) — RESOLVED

These are stubs but the DOM has full equivalents — should be promoted from `missing` to working bindings.

- `setLabelDoubleClickCallback` — DOM `dblclick`.
- `setLabelReleaseCallback` — DOM `mouseup`.
- `setLabelMoveCallback` — DOM `mousemove`.
- `setLabelWheelCallback` — DOM `wheel`.
- `setLabelOnEnter` — DOM `mouseenter`.
- `setLabelOnLeave` — DOM `mouseleave`.

`LuaRuntime.ts:396-401`. Used by Geyser gauges and many HUD packages.

**Fix:** all six are now real bindings. `LabelManager` grew a slot for each (`onMouseUp`, `onDoubleClick`, `onMouseMove`, `onWheel`, `onMouseEnter`, `onMouseLeave`); `LabelOverlay` wires the corresponding React handlers, builds a Mudlet-shaped event table (mouse callbacks get `{button, x, y, globalX, globalY, alt, ctrl, shift, meta}`; the wheel callback adds `angleDelta = {x, y}` derived from `WheelEvent.deltaX/Y` with the sign flipped to match Qt's "scroll up = positive" convention). All six route through the same Bridge.lua `bind` helper as `setLabelClickCallback`, so they support fn-or-code, `nil` to clear, trailing varargs baked into the closure, and the per-slot leak fix from #23.

### 26. Missing `setCmdLineAction` / `resetCmdLineAction` — RESOLVED

Real Mudlet APIs that intercept Enter on the command bar. mudix declares them as stubs. Scripts that want a custom command parser fall through to default sending. `LuaRuntime.ts:402-403`.

**Fix:** `ScriptingAPI` got a single nullable `cmdLineAction` slot; `ScriptingEngine.processInput` checks it before alias matching and consumes the line by invoking the action with the typed text (errors are routed through `printError` and still consume so untransformed text doesn't leak to the MUD). The Lua side uses the same cb-id-with-arg path as label callbacks: Bridge.lua's `setCmdLineAction(...)` accepts both `(fn, ...)` and `(cmdLineName, fn, ...)` (the name is dropped — single command bar), bakes trailing varargs into the closure, treats `fn == nil` as clear, and the JS-side `cmdLineActionCbId` is freed via `__mudix_unregister_cb` on rebind so the registry doesn't leak. `resetCmdLineAction([cmdLineName])` clears the action.

### 27. Missing `setAppStyleSheet` / `setUserWindowStyleSheet` — RESOLVED

Real Mudlet APIs that scripts (theme switchers, package CSS) depend on. Browser approximations exist (inject `<style>` into `document.head`, scope per-panel). Currently no-op stubs. `LuaRuntime.ts:363-378`.

**Fix:** both bindings now install (or replace) a real `<style>` element in `document.head`. `setAppStyleSheet(css, [tag])` uses `mudix-app-stylesheet-{tag}` as the element id so multiple themes can coexist, and raises `sysAppStyleSheetChange` via a new `eventRaiser` callback that ScriptingEngine wires up (the same mechanism already used for `sysWindowResizeEvent`). `setUserWindowStyleSheet(name, css)` uses `mudix-userwindow-stylesheet--{name}`. `TextPanel` and `HtmlPanel` now stamp `data-mudix-window={id}` on their viewport so script CSS can self-scope via `[data-mudix-window="..."] selector`. Qt-specific QSS selectors (`QLabel::hover`, etc.) still need the css rewriter to translate them, but plain web CSS — what every modern theme package emits — works as-is.

### 28. `remainingTime` is a stub — RESOLVED

Always returns `-1`. Mudlet returns seconds remaining on a scheduled timer. `LuaRuntime.ts:1048` (TODO).

**Fix:** `TimerEngine` now stores each timer's `start` (epoch ms) and resolved `intervalMs` alongside the handle. `remainingTime(idOrName)` returns `intervalMs - elapsed` for one-shot timers (clamped at 0) and `intervalMs - (elapsed % intervalMs)` for repeating timers (always > 0, never the just-fired 0). Numeric arg looks up tempTimer ids; string arg looks up perm timers by stored id first, falling back to a name → id index built at `loadPerm`. Misses still return -1.

---

## Per-category tables

### Output / formatting

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| echo | `echo([miniconsole|label,] text)` | `echo(a, b?)` | OK; label routing replaces HTML (matches Mudlet) | OK |
| fg | `fg([window], colorName)` | `fg(name)` (overwritten by GUIUtils.lua wrapper) | Dead JS binding, GUIUtils.lua provides full surface | OK |
| bg | `bg([window,] colorName)` | same pattern as `fg` | same | OK |
| setFgColor | `setFgColor([win], r, g, b)` | overload via `typeof a === 'string'` | Each channel validated (finite int rounded into 0–255); invalid args silent no-op | fixed |
| setBgColor | `setBgColor([win], r, g, b, [alpha])` | matches | Optional alpha plumbed through `RgbColor`; alpha < 255 renders via `rgba()`; same channel validation | fixed |
| setBold/Italics/Underline/StrikeOut | `set*([win,] bool)` | overload via first-arg type | OK; `!!a` coerces non-bool | OK |
| resetFormat | `resetFormat([win])` | adds selection-clearing layer | OK | OK |
| deselect | `deselect([win])` | matches | When `win` is given, only clears the selection if it belongs to that window; no-arg form clears unconditionally | fixed |
| insertText | `insertText([win,] text)` | overload by arg count | OK | OK |
| deleteLine | `deleteLine([win])` | OK | OK | OK |
| replace | `replace([win,] with, [keepcolor])` | matches | 2-arg form disambiguated by `typeof b` (string=window, boolean=keepcolor); default applies the resolved console's current pen state, `keepcolor=true` preserves the selection's existing format | fixed |
| echoLink | `echoLink([win,] text, cmd, hint, [useCurrentFmt])` | matches | Default styles the link with Mudlet's built-in blue + underline; `useCurrentFormat=true` preserves the current pen instead | fixed |
| echoPopup | `echoPopup([win,] text, {cmds}, {hints}, [useCurrentFmt])` | argc-based detection in Bridge.lua wrapper | Auto-detects no-window form (3-arg) and disambiguates 4-arg via `type(arg2)` | fixed |
| selectCaptureGroup | `(groupNum|groupName)` | resolved | (see #6 in Top priorities) | fixed |
| printError | `printError(msg, [showStack], [haltExec])` | matches | `showStackTrace` accepted (no JS stack to render); `haltExecution=true` raises a Lua error so the calling script aborts | fixed |
| feedTriggers | `feedTriggers(text, [utf8=true])` | `(text)` only | Drops encoding flag (irrelevant in JS) | OK |

### Selection / cursor / line

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| selectString | `([win,] text, occurrence) → start col or -1` | same | OK | OK |
| selectSection | `([win,] from, length) → bool` | matches | Validates from/length ≥ 0 and that the buffer exists; returns bool | fixed |
| getSelection | `([win]) → text, start, length OR nil, errMsg` | matches | Bridge.lua wrapper now hands back `nil, "no selection"` (Mudlet shape) instead of `false, msg` | fixed |
| isPrompt | reflects `promptBuffer[userCursorY]` | per-line flag on `AnsiAwareBuffer` | The prompt flag now travels on the buffer via `ScriptingAPI.beginLine`; `isPrompt([win])` reads `Console.cursorOnPrompt()` so moveCursor + isPrompt inspects historical lines too | fixed |
| getCurrentLine | `([win]) → string OR nil, errMsg` | matches | Bridge.lua wrapper returns `nil, errMsg` when the named window doesn't exist; main always resolves (empty string when no current line) | fixed |
| getLineNumber | `([win]) → 0-indexed cursor.y` | resolved (see #1 in Top priorities) | — | fixed |
| getLineCount | `([win]) → size - 1` (last index) | resolved (see #1) | — | fixed |
| getLastLineNumber | `([win]) → size - 1`; -1 if missing | resolved (see #1) | — | fixed |
| getColumnNumber | `([win]) → mUserCursor.x()` (persistent) | matches | Reads `Console.cursorCol` outside triggers; trigger lineBuffer column inside | fixed |
| getColumnCount | font-metric column count | DOM probe; returns 0 if not mounted | Equivalent for monospace | minor |
| setWindowWrap | `(name, wrapAt)` no return; name required | `(name, n) → bool` | `name` arg is required (non-string raises a bad-argument error, matching Mudlet's "missing required arg" failure); returns bool — `true` for main/known windows, `false` for unknown | fixed |
| getLines | `([win,] from, to) → 1-indexed table` | matches | Bridge.lua wrapper rebuilds the JS array as 1-indexed | fixed |
| moveCursorUp | `([win,] [lines=1,] [keepHoriz])` | matches | Disambiguates by arg type; honors `lines`; ignores `keepHorizontal` | fixed |
| moveCursorDown | `([win,] [lines=1,] [keepHoriz])` | matches | same | fixed |
| moveCursorEnd | `([win])` — last char of last line | matches | Moves to the last line and sets the column cursor to that line's length via `setCursorColumn` + `markCursorAtEnd` (rendered history has a persistent column cursor) | OK |
| moveCursor | `([win], x, y) → bool` | matches | Console owns a persistent column cursor; both line and column are honored on rendered history | fixed |

### Windows / labels

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| windowType | string kind or `nil, errMsg` | matches | Bridge.lua wrapper turns the miss case into `nil, errMsg`. mudix has no buffer/commandline/textedit panel kinds, so those kinds are still not reported | fixed |
| openUserWindow | `(name, [restoreLayout, autoDock, dockingArea]) → true` | matches | The internal `WindowHandle` is no longer leaked across the bridge; binding returns `true` after the panel is registered | fixed |
| openMapWidget | `([area\|x,y[,w,h]]) → true` | matches | 2-arg `(x, y)` floats the widget at that point (size inherits saved hint); 4-arg form unchanged; always returns `true` | fixed |
| clearUserWindow | `([name])` — defaults to main | matches | No-arg call now clears the main console (same as `clearWindow`) | fixed |
| clearWindow | alias of clearUserWindow | OK | OK | OK |
| createMiniConsole | `([parent,] name, x, y, w, h)` — parent nests inside userwindow | matches | Parent stored on window data; non-main parent portals into the parent's viewport so (x, y) are parent-relative | fixed |
| hideWindow | `(name)` — labels first, then sub-consoles | matches | OK | OK |
| showWindow | `(name) → bool` | matches | Routes to label manager first, then `WindowManager.show`; returns true when the target exists | fixed |
| moveWindow | `(name, x, y)` — labels first | matches | OK | OK |
| resizeWindow | `(name, w, h)` — labels first | matches | OK | OK |
| setUserWindowTitle | `(name, [title]) → bool` — empty resets | matches | Missing title resets the panel header to the window id; missing window returns false | fixed |
| setBackgroundColor | `([name,] r, g, b, [a]) → bool` | matches | Each channel validated as 0–255 int via the shared `channel()` helper; invalid args return false; main/label/userwindow routing returns bool | fixed |
| getBackgroundColor | `([name]) → r, g, b, a OR nil, errMsg` | matches | Raw JS bridge returns `null` for missing labels/userwindows; Bridge.lua wrapper hands back `nil, errMsg`. Main always resolves to `{0,0,0,255}` when no override is set | fixed |
| createLabel | `([parent,] name, x, y, w, h, fillBg, [clickThrough])` | overload by 2nd-arg type | `fillBackground` / `clickThrough` are validated as actual booleans — non-bool args throw a bad-argument error (Mudlet shape) instead of silent `!!` coercion | fixed |
| deleteLabel | `(name) → true OR false, errMsg` | matches | Bridge.lua wrapper turns the JS bool into `(false, errMsg)` on miss | fixed |
| setLabelStyleSheet | Qt CSS | DOM CSS via cssRewriter | `qtCss.cssTextToParts` splits the stylesheet into a base block (inline) plus pseudo-state rulesets (`QLabel:hover`, `QLabel::hover`, `QLabel:pressed` → `:active`, `QLabel:!hover` → `:not(:hover)`, etc.). LabelOverlay injects a per-label `<style id="mudix-label-stylesheet--{name}">` scoped via `[data-mudix-label]` and tears it down on unmount or stylesheet change. Unknown selectors (non-QLabel widget types) are dropped — they wouldn't have applied to a QLabel in Mudlet either | fixed |
| setLabelClickCallback | `(name, fn|nil, [args...])`; fn receives event table | matches | Event table `{button, x, y, globalX, globalY, alt, ctrl, shift, meta}`; `nil` clears; trailing args baked into closure; per-slot cb id tracked + freed on rebind | fixed |
| setLabelToolTip | `(name, text, [duration]) → bool` | matches | Forwards `LabelManager.setTooltip`'s bool (false when the label is missing); duration arg accepted for parity but the DOM `title` attribute has no per-tip timeout | fixed |
| resetLabelToolTip | `(name)` | matches | OK | OK |
| enableClickthrough | `(name)` | matches | OK | OK |
| disableClickthrough | `(name)` | matches | OK | OK |
| raiseWindow | `(name)` — labels and userwindows | matches | Routes to label manager or `WindowManager.bringToFront`; `raiseLabel` kept as legacy alias | fixed |
| lowerWindow | `(name)` — labels and userwindows | matches | Same; `WindowManager.sendToBack` computes a fresh below-min zIndex; `lowerLabel` kept as legacy alias | fixed |
| setLabelCursor | `(name, shapeInt|shapeName)`; GUIUtils.lua also wraps strings | int or string | The primitive itself now accepts the string shape names (mirrors `mudlet.cursor` keys) via `QT_CURSOR_NAME_TO_INT`; the bundled GUIUtils.lua wrapper still works on top of it | fixed |
| resetLabelCursor | `(name)` | matches | OK | OK |
| setAppStyleSheet | `(css, [tag]) → true`; raises sysAppStyleSheetChange | matches | Installs/replaces `<style id="mudix-app-stylesheet-{tag}">`; raises `sysAppStyleSheetChange` | fixed |
| setUserWindowStyleSheet | `(name, css) → bool` | matches | Installs/replaces `<style id="mudix-userwindow-stylesheet--{name}">`; panels expose `data-mudix-window` for script-side scoping | fixed |
| setLabelDoubleClickCallback | `(name, fn|nil, [args...])` | matches | Wired via DOM `dblclick`; same event-table + clear + leak-fix path as `setLabelClickCallback` | fixed |
| setLabelReleaseCallback | `(name, fn|nil, [args...])` | matches | Wired via DOM `mouseup`; same path | fixed |
| setLabelMoveCallback | `(name, fn|nil, [args...])` | matches | Wired via DOM `mousemove`; same path | fixed |
| setLabelWheelCallback | `(name, fn|nil, [args...])` | matches | Wired via DOM `wheel`; event also carries `angleDelta = {x, y}` | fixed |
| setLabelOnEnter | `(name, fn|nil, [args...])` | matches | Wired via DOM `mouseenter`; same path | fixed |
| setLabelOnLeave | `(name, fn|nil, [args...])` | matches | Wired via DOM `mouseleave`; same path | fixed |

### Mapper

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| centerview | `(roomID)` | matches | OK | OK |
| getRoomIDbyHash | returns -1 if not found | matches | Returns the matched id or -1 (Mudlet's "no match" sentinel) | fixed |
| setRoomIDbyHash | matches | OK | OK | OK |
| getRoomHashByID | string or `(false, errMsg)` | matches | Bridge.lua wrapper turns the JS string/null into the documented multi-return | fixed |
| loadMap | `([location])` — accepts `.dat`/`.xml` | `.dat` only | No XML import | minor |
| createRoomID | `([minimum])` | matches | `minimum` is honored — returns the smallest unused id ≥ `minimum`, advancing the running cursor when it overruns | fixed |
| addRoom | `(roomID, areaID) → bool` | `(roomID, areaID?)` | Optional `areaID` is honored; the area is created if missing and the room is registered on its `rooms` list | fixed |
| deleteRoom | `(roomID) → bool` | matches | `MapStore.deleteRoom` returns false when the room doesn't exist, true after removal | fixed |
| roomExists | `(roomID) → bool` | matches | OK | OK |
| getRoomName | string or `(false, errMsg)` | matches | Bridge.lua wrapper turns the JS string/null into the documented multi-return | fixed |
| setRoomName | matches; no return | matches | `MapStore.setRoomName` now returns true/false so the binding reports whether the room existed | fixed |
| getRoomArea | number; `-1` on miss | matches | Returns the room's area id, or `-1` when the room doesn't exist | fixed |
| setRoomArea | `(roomID|{ids}, areaID|areaName) → bool` | accepts both | Single ID and array of IDs supported; area lookup by ID or name; returns bool | fixed |
| getRoomCoordinates | `x, y, z` (3 returns) | matches | Bridge.lua wrapper unpacks the JS `[x,y,z]` triplet so Lua sees 3 separate return values | OK |
| setRoomCoordinates | matches; bool | matches | `MapStore.setRoomCoordinates` returns true on update, false when the room is missing | fixed |
| getRoomsByPosition | 0-indexed table | 0-indexed via wasmoon | OK | OK |
| getRoomEnv | number; `-1` on miss | matches | Returns the room's environment id, or `-1` when the room doesn't exist (matches Mudlet's "no such room" sentinel) | fixed |
| setRoomEnv | matches | matches | Returns true on update, false when the room is missing | fixed |
| getRoomChar | string or `(nil, errMsg)` | matches | Raw JS returns `null` for missing rooms; Bridge.lua wrapper turns it into `(nil, "no such room id")` and forwards the symbol (may be empty when no symbol set) otherwise | fixed |
| setRoomChar | matches | matches | Returns true on update, false when the room is missing | fixed |
| getRoomUserData | `(id, key, [fullErr])` | matches | Default returns `""` when room or key is missing (Mudlet shape, so concatenation is safe); `fullErr=true` differentiates the cases via `(false, errMsg)` | fixed |
| setRoomUserData | matches; bool | matches | Returns true on update, false when the room is missing | fixed |
| getMapUserData | string or `(false, errMsg)` | matches | Bridge.lua wrapper returns `(false, "no such map user data key")` when the key was never set; stored empty strings still return `""` | fixed |
| setMapUserData | matches | matches | OK | OK |
| clearMapUserData | no args; clears entire dict | resolved (see #7 in Top priorities) | `clearMapUserData()` wipes all; `clearMapUserDataItem(key)` clears one | fixed |
| getAllMapUserData | matches | matches | OK | OK |
| getRoomExits | `{[dir]=roomID}` | matches | OK | OK |
| setExit | `(from, to, dir)` — dir is string OR int | both forms accepted | `parseDirection()` normalizes int 1-12 or name ("north"/"n"); returns bool | fixed |
| getExitStubs | 0-indexed table | 0-indexed | OK | OK |
| setExitStub | `(roomID, dir, set)` — dir is string OR int | both forms accepted | Same `parseDirection()` normalization; returns bool | fixed |
| addSpecialExit | matches; bool | matches | Returns true on update, false when the source room is missing | fixed |
| removeSpecialExit | matches; bool | matches | Returns true when the special-exit was removed, false when the room or cmd entry is missing | fixed |
| getSpecialExitsSwap | `{[cmd]=toRoomID}` | matches | OK | OK |
| getDoors | `{[dir]=status}` | matches | OK | OK |
| setDoor | `(roomID, exitCmd, status) → bool` — validates exit | accepts int or name; falls through to special-exit cmd | Door key normalizes to canonical field name for stock directions; returns bool | fixed |
| addMapEvent | no return | matches | Lua binding drops the JS bool result — addMapEvent is mutating only | fixed |
| removeMapEvent | no return | matches | same | fixed |
| getMapEvents | `{[unique]={["event name"]=, ["parent"]=, ["display name"]=, ["arguments"]={...}}}` | matches | Bridge.lua wrapper builds the literal-key shape and rebuilds args 1-indexed | fixed |
| setCustomEnvColor | `(envID, r, g, b, a)` | matches | Channels validated as 0..255 ints via the shared `channel()` helper (mirrors `setFgColor` / `setBgColor`); invalid args silent no-op. Alpha is stored but the map renderer still consumes RGB only | fixed |
| getCustomEnvColorTable | `{ [envID] = {r, g, b, a} }` (1-indexed inner) | matches | Bridge.lua wrapper rebuilds the inner JS `{r,g,b,a}` object as the 1-indexed `{r,g,b,a}` array and coerces envID keys back to numbers. Mudix's per-id `getCustomEnvColor(id)` kept as a one-shot helper alongside the canonical accessor | fixed |
| addAreaName | `→ areaID OR (false, errMsg)` on dup | matches | Returns numeric ID on success, `(false, errMsg)` on duplicate or empty name (via Bridge.lua wrapper) | fixed |
| deleteArea | `(areaID|areaName) → bool` | both forms accepted | Returns bool; mudix still deletes contained rooms (Mudlet moves them to default) — flagged as future follow-up | fixed |
| getAreaTable | `{[name]=id}` | matches | OK | OK |
| getRoomAreaName | `(areaID|areaName)` — bidirectional | bidirectional | Number → name string; name → ID | fixed |
| setAreaName | `(areaID|areaName, newName) → bool` | both forms accepted | Bridge.lua wrapper turns conflict/missing into `(false, errMsg)`; returns true on success | fixed |
| getAreaRooms | 0-indexed table | matches | OK | OK |
| getRooms | `{[id]=name}` | matches | OK | OK |

### Triggers / aliases / timers / scripts / packages / modules

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| tempTimer | `(seconds, code|fn, [repeating])` → id | matches | OK | OK |
| tempAlias | `(regex, code|fn)` | matches | OK | OK |
| tempTrigger | substring-match | resolved (see #5 in Top priorities) | — | fixed |
| tempRegexTrigger | regex match | regex | shares primitive — OK for this name | OK |
| tempKey | `([modifier,] keyCode, fn)` — modifier optional; keyCode is Qt::Key int | resolved (see #4 in Top priorities) | — | fixed |
| killTimer | `(id|name) → bool` | resolved (see #2 in Top priorities) | — | fixed |
| killAlias | `(name) → bool` | resolved (see #2) | — | fixed |
| killTrigger | `(id|name) → bool` | resolved (see #2) | — | fixed |
| killKey | `(name) → bool` | resolved (see #2) | — | fixed |
| enableTrigger/disableTrigger/enableTimer/disableTimer | `(name) → bool` | matches | OK | OK |
| enableScript/disableScript | `(name) → true` (errors if missing) | matches | Lua binding raises with `"enableScript: no script named …"` on miss, returns `true` on success | fixed |
| exists | `(name|id, type) → count` | matches | Numeric id form resolves via the engine's perm-id index; string form unchanged. `key`/`keybind` both accepted | fixed |
| permScript | `(name, parent, code) → numeric id` | resolved (see #3 in Top priorities) | — | fixed |
| permRegexTrigger | `(name, parent, regexes, code) → numeric id` | resolved (see #3) | — | fixed |
| setScript | `(name, code, [pos]) → numeric id` | resolved (see #3) | — | fixed |
| installPackage | `(location)` — http URLs via Other.lua | VFS path; Other.lua overrides to also accept URLs | `Other.lua` (bundled in `src/scripting/lua/mudlet-lua/`) is loaded via `LuaGlobal.lua`'s file list and replaces the JS primitive at runtime with the URL-aware version (it routes http(s)://… through `installPackageFromUrl` + `downloadFile`) | OK |
| uninstallPackage | `(name) → true | nil` | matches | Returns `true` on success, `nil` when no package with that name is installed (Mudlet shape) | fixed |
| getPackages | 1-indexed table | Bridge rebuilds | OK | OK |
| installModule | `(location) → true` | bool | Returns true on success, false on failure (errors logged via `printError`) | fixed |
| uninstallModule | matches | matches | OK | OK |
| reloadModule | no return | matches | Binding drops the JS bool result (Mudlet shape); failure still logs via `printError` | fixed |
| syncModule | not in Mudlet's canonical Lua API | fire-and-forget alias for force-flush | mudix-specific | minor |
| enableModuleSync/disableModuleSync | `→ true`; raises on unknown | matches | Both bindings throw "<name> is not an installed module" on miss and return `true` on success | fixed |
| getModuleSync | `→ bool`; raises on unknown | matches | Unknown module raises (Mudlet shape) instead of silently returning false | fixed |
| setModulePriority | `→ true`; raises on unknown | matches | Unknown module raises; truncates the priority to an int and returns `true` on success | fixed |
| getModulePriority | number; raises on unknown | matches | Unknown module raises (Mudlet shape) | fixed |
| getModules | 1-indexed | Bridge rebuilds | OK | OK |
| getModuleInfo | table or string | matches | Bridge.lua wrapper returns `nil` for unknown modules (Mudlet shape); with a `key` arg it forwards `info[key]` directly. JS layer returns `null` on miss | OK |
| raiseEvent | `→ true`; supports tables/functions via registry refs | matches | Returns `true` once handlers have fired (synchronous dispatch); empty/missing event name returns `false`. Table args still rely on wasmoon conversion | fixed |
| registerAnonymousEventHandler | `→ numeric id` | stub returns 0; mudlet-lua/Other.lua overrides | Confirmed: bundled `Other.lua` overwrites the JS stub at module load with its own Lua implementation that registers/dispatches handlers; the JS stub only satisfies the one bootstrap call `registerAnonymousEventHandler("*", "dispatchEventToFunctions")` before Other.lua redefines it | OK |
| showHandlerError | logs via host.mLuaInterpreter | `printError("[event \"…\"] …")` | parallel | OK |
| expandAlias | `(cmd, [echo])` — default echo is **false** (nil → false) | matches | `nil`/missing echo now defaults to `false` (Mudlet shape); explicit boolean honored; binding returns `true` | fixed |
| denyCurrentSend | sets gate flag | matches | OK | OK |
| sendCmdLine | stages text in cmdbar (no submit) | matches | Emits `script.setcmd` to replace bar contents; App handler focuses + selects all; `cmdLineName` arg accepted and ignored | fixed |
| send | `(cmd, [echo=true]) → true` | matches | Returns `true` once the send is dispatched | fixed |
| sendGMCP | `(message, [what])` | matches | Optional `what` is concatenated to `message` with a space separator before framing (Mudlet behaviour) | fixed |
| saveProfile | `([location, [filename]]) → (true, filename) | (nil, errMsg)` | matches | Returns `(nil, errMsg)` synchronously when no profile VFS is available; otherwise returns `(true, path)` and raises `sysSaveProfileError(path, errMsg)` if the async flush fails. `location` and `filename` are accepted for parity but ignored — there is no alternate save target | fixed |
| unzipAsync | matches | matches | OK | OK |
| remainingTime | `(id|name) → seconds` | matches | TimerEngine tracks start+intervalMs per entry; numeric→tempTimer, string→perm via id/name index; -1 on miss | fixed |
| selectCaptureGroup | numeric AND named | resolved (see #6 in Top priorities) | — | fixed |

### Network / HTTP / cmdline

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| getNetworkLatency | seconds float; `-1` when no measurement | matches | Caches the most recent measurement; returns `-1` until the first ping completes (was a fake `0`) | fixed |
| downloadFile | `(saveTo, url) → (true, url)` | matches | Bridge.lua wrapper kicks off the JS primitive and returns `(true, url)`; sysDownloadDone third arg is still empty | fixed |
| getHTTP | `(url, headers) → (true, url)` | matches | Bridge.lua wrapper returns `(true, url)` | fixed |
| postHTTP | `(data, url, headers, file) → (true, url)` | matches; file via VFS | Bridge.lua wrapper returns `(true, url)` | fixed |
| putHTTP | `(data, url, [headers, file]) → (true, url)` | matches | Bridge.lua wrapper returns `(true, url)` | fixed |
| deleteHTTP | `(url, headers) → (true, url)` | matches | Bridge.lua wrapper returns `(true, url)` | fixed |
| customHTTP | C++: `(method, data, url, headers, file)` | matches | Optional `file` arg now plumbed through `HttpService.bodyForUpload`; Bridge.lua wrapper returns `(true, url)` | fixed |
| appendCmdLine | `([name,] text)` | name dropped (single bar) | OK | OK |
| printCmdLine | `([name,] text)` | name dropped | OK | OK |
| clearCmdLine | `([name])` | name dropped | OK | OK |
| addCommandLineMenuEvent | `([cmdLineName,] menuLabel, eventName)` — **no displayName** | matches | 2-arg `(menuLabel, eventName)` and 3-arg `(cmdLineName, menuLabel, eventName)` (cmdLineName dropped) | fixed |
| removeCommandLineMenuEvent | `([cmdLineName,] menuLabel) → bool` | matches | Bridge.lua wrapper returns `(false, errMsg)` when no entry by that name exists; `cmdLineName` is accepted for parity and ignored | fixed |
| getCommandLineMenuEvents | not in Mudlet C++ | mudix-only | OK as extension | OK |
| setCmdLineAction | `(cmdLineName, fn, [args...])` — intercepts Enter | matches | Single-bar form; cmdLineName arg accepted and ignored. fn=nil clears; trailing args baked into closure; cb id freed on rebind | fixed |
| resetCmdLineAction | `(cmdLineName) → bool` | matches | Clears the action and frees the cb id | fixed |
| openWebPage | `(url) → bool` | matches | Returns `false` for empty URLs or when the popup is blocked; `true` once `window.open` succeeds | fixed |
| debugc | single arg, routes to error-info console | single `content` arg → devtools `console.debug` | mudix routes to the browser console (no dedicated "Errors" dock) — Mudlet behaviour, just a different sink | fixed |
| errorc | `(content, [debugInfo])` | matches | Accepts `content` + optional `debugInfo`; concatenates with a single space before printing through the script log (same destination as `printError`) | fixed |

### Borders / fonts / sizes / version / misc

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| setBorderTop/Bottom/Left/Right | `(size)` | matches | OK | OK |
| setBorderSizes | 1/2/3/4 args (uniform / vertical-horizontal / top-h-bottom / TRBL) | matches | All four arities case-split in `ScriptingAPI.setBorderSizes` | fixed |
| getBorderTop/Bottom/Left/Right/Sizes | matches | matches | OK | OK |
| setBorderColor | `(r,g,b)` (alpha forced 255) | matches | Channels validated as 0..255 ints via the shared `channel()` helper; alpha arg accepted for parity and forced to 255 (Mudlet shape) | fixed |
| resetBorderColor | doesn't exist in Mudlet | mudix extension | OK | OK |
| setFontSize | `([name,] size)` size>0; `→ true \| nil, errMsg` | matches | Bridge.lua wrapper shapes the miss case as `(nil, errMsg)`; the unit remains CSS px (Mudlet's pointSize doesn't translate cleanly to a DOM target) | fixed |
| getFontSize | `([name])` size or `(nil, errMsg)` | matches | Bridge.lua wrapper shapes the miss case as `(nil, errMsg)`; size is reported in CSS px | fixed |
| setFont | `([name,] family)` `→ true \| nil, errMsg` | matches | Bridge.lua wrapper shapes the miss case as `(nil, errMsg)`. The browser already falls back when the requested family isn't installed; no separate availability check | fixed |
| getFont | `([name])` family or `(nil, errMsg)` | matches | Bridge.lua wrapper shapes the miss case as `(nil, errMsg)`; main window returns the configured family or `""` when unset | fixed |
| getMainWindowSize | console-only area (excludes toolbars/borders) | viewport minus borders | Subtracts the configured `outputBorders` insets so the returned `(w, h)` matches the usable console area rather than the full viewport rectangle | fixed |
| getUserWindowSize | size or `(nil, errMsg)` for missing | matches | Bridge.lua wrapper turns the JS `null` miss-case into `(nil, "userwindow ... not found")` | fixed |
| getMudletVersion | `"table"` mode → 4 returns `(M, m, r, build)` | 4 returns | Bridge.lua now returns BUILD as the 4th value | fixed |
| getProfileName | host profile dir name | connection display name | Semantically close, not identical | minor |
| getEpoch | seconds with sub-second precision | `Date.now()/1000` | OK | OK |

---

## What was excluded from audit

- **Pure-Lua wrappers in bundled `mudlet-lua/`**: `cecho`, `decho`, `hecho`, `xEcho`, `cinsertText`, `creplace`, `cechoLink`, `decho2cecho`, etc. They're verbatim Mudlet code and only fail if a primitive (`setFgColor`, `setBgColor`, `insertText`, `deleteLine`, `selectString`) is broken. The primitives are audited above.
- **`mudlet-lua/lua/StringUtils.lua` / `TableUtils.lua` / `DB.lua` / `DateTime.lua` / `GeyserGeyser.lua` / etc.** — bundled verbatim.
- **GMCP / MSSP / MCMP / Discord / TTS** — not present in mudix's binding surface; deliberately scoped out.
- **`auditAreas`, `searchRoom`, `searchAreaUserData`, `getMapMenus`, `addMapMenu`, ...** — many less-common mapper APIs are not exposed by mudix; they are missing-feature items, not behavior bugs, and weren't in the agent's scope.

Use this report as input to a follow-up plan: each major + missing item maps to a discrete fix.
