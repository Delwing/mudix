# Mudlet API Parity Audit

Full per-function comparison of the Lua API exposed by **mudix** (`src/scripting/lua/LuaRuntime.ts` + `src/scripting/lua/Bridge.lua` + `src/scripting/ScriptingAPI.ts`) against the canonical Mudlet API (`src/lua-function-list.json` and `src/TLuaInterpreter*.cpp` in the Mudlet repo).

Scope: ~200 native bindings. Pure-Lua wrappers in bundled `mudlet-lua/` (cecho, decho, hecho, xEcho, etc.) are **out of scope** — they're verbatim Mudlet code; only the underlying primitives they call are audited.

## Totals

| Severity | Count | Meaning |
|---|---|---|
| OK | 58 | No meaningful discrepancy. |
| minor | 91 | Same calls accepted, edge-case behavior or return shape differs. |
| major | 38 | Wrong arg count/order, missing required arg, broken overload, wrong return type. |
| missing | 11 | Declared as a stub but Mudlet has real behavior scripts depend on. |

---

## Top priorities (major + missing, by impact)

The discrepancies most likely to silently break ported Mudlet scripts.

### 1. Off-by-one in line-number APIs (cursor)

Mudlet's `getLineCount`, `getLastLineNumber`, `getLineNumber` all return **0-indexed line index** (i.e. `size - 1`); mudix returns 1-indexed counts. Any script doing `for i = 1, getLineCount() do` will read one line past the end (or skip the first line, depending on intent).

- `getLineNumber([win])` — mudix `cursor + 1`, Mudlet `mUserCursor.y()` (0-indexed). `Console.ts:138`, `ScriptingAPI.ts:715`.
- `getLineCount([win])` — mudix `history.length`, Mudlet `size - 1`. `Console.ts:139`.
- `getLastLineNumber([win])` — mudix `history.length`, Mudlet `size - 1` (and `-1` for missing window). `ScriptingAPI.ts:723`.

### 2. Kill APIs take numeric tempIDs, but Mudlet takes name strings

Mudlet's `killTimer/killAlias/killTrigger/killKey` accept the **name string** of a permanent item. mudix only accepts the numeric ID returned by `tempTimer/tempAlias/...`. Calling `killTimer("myTimer")` is a silent no-op.

- `killTimer`, `killAlias`, `killTrigger`, `killKey` — `LuaRuntime.ts:816,828,863,881`.

### 3. `permScript` / `permRegexTrigger` / `setScript` return UUID strings, not ints

Mudlet returns a numeric `id` on success. mudix returns a UUID string from the Zustand store. Code doing `if id > 0 then …` works (string is truthy) but anything storing the id as a key in a numeric table breaks.

- `LuaRuntime.ts:697-714`, `ScriptingAPI.ts:399-409`.

### 4. `tempKey` requires modifier; numeric keycodes don't translate

- Mudlet: `tempKey([modifier,] keyCode, fn)` — modifier optional; `keyCode` is a Qt::Key int.
- mudix: requires 3 args; passes the key through `String(key)`. Numeric Qt::Key codes get stringified instead of mapped to a `KeyboardEvent.key` value, so `tempKey(0x4000000, 0x01000004, fn)` (Ctrl+Enter) won't match. `LuaRuntime.ts:870-880`.

### 5. `tempTrigger` does regex matching, not substring

Mudlet's `tempTrigger` is **substring-match** (a literal contains check). `tempRegexTrigger` is regex. mudix routes both to `TriggerEngine.addTemp`, which compiles the pattern as PCRE. Scripts written for `tempTrigger` will fail when their substring contains regex metacharacters (`(`, `[`, `?`, etc.).

- `LuaRuntime.ts:840-862`, shared primitive.

### 6. `selectCaptureGroup`

- **Numeric form**: mudix re-runs `selectString(text, 1)` — picks the **first** occurrence of the captured substring on the line, not the actual capture position. If the captured text appears more than once, this selects the wrong span.
- **Named form**: returns `-1` (TODO). `LuaRuntime.ts:914-922`.

### 7. `clearMapUserData` clears a single key (Mudlet clears the whole map dict)

Mudlet: `clearMapUserData()` (no args, clears entire map user-data table) — Mudlet's `clearMapUserDataItem(key)` clears one key. mudix's `clearMapUserData(key)` is doing the **`Item`** behavior under the wrong name. Scripts calling `clearMapUserData()` with no args silently clear `""`.

- `LuaRuntime.ts:459`, `ScriptingAPI.ts → MapStore.clearMapUserData`.

### 8. `setExit` / `setExitStub` / `setDoor` reject string directions

Mudlet accepts both string (`"north"`, `"n"`) and integer (1–12) directions. mudix only accepts integers. Most user scripts use strings. `LuaRuntime.ts:464-473`.

### 9. Area APIs reject name lookups

`setRoomArea`, `getRoomAreaName`, `setAreaName`, `deleteArea`: Mudlet accepts either area-ID number **or** area-name string. mudix only accepts numeric IDs. `LuaRuntime.ts:437,532-533,530`.

### 10. `addRoom` drops the `areaID` arg

Mudlet: `addRoom(roomID, areaID)`. mudix: `addRoom(id)` only — the room is created but never assigned to its target area. `LuaRuntime.ts:429`.

### 11. `getMapEvents` uses wrong field names

Mudlet shape: `{[uniqueName] = {["event name"]=, ["parent"]=, ["display name"]=, ["arguments"]={...}}}`. mudix returns `{event=, parent=, display=, args=}`. `LuaRuntime.ts:497-508`.

### 12. `addAreaName` returns existing ID on duplicate

Mudlet returns `(false, errMsg)` on duplicate or empty name. mudix returns the existing ID, masking the conflict from script logic. `LuaRuntime.ts:529`.

### 13. `addCommandLineMenuEvent` arg semantics wrong

Mudlet: `addCommandLineMenuEvent([cmdLineName,] menuLabel, eventName)` — **no `displayName` arg**. mudix treats the 4-arg form as `(cmdLineName, uniqueName, event, displayName)` and the 3-arg form as `(uniqueName, event, displayName)`. The `displayName` slot doesn't exist in Mudlet; menu entries display the `menuLabel` directly. `LuaRuntime.ts:607-627`.

### 14. `echoPopup` no-window form is broken

Bridge.lua's wrapper does not auto-detect the no-window form. Calling `echoPopup(text, {cmds}, {hints})` (3 args) ends up with `text` interpreted as a window name and `{cmds}` interpreted as the popup text. Mudlet's C++ uses argc-based detection. `Bridge.lua:302`.

### 15. `getMudletVersion("table")` returns 3 values, not 4

Mudlet returns `(major, minor, revision, build)`. mudix returns `(major, minor, revision)` only — drops `build`. `Bridge.lua:106`.

### 16. `setBorderSizes` missing 2-arg and 3-arg overloads

Mudlet supports 1, 2, 3, or 4 args (uniform / vertical-horizontal / top-horizontal-bottom / TRBL). mudix supports only 1 and 4. `LuaRuntime.ts:1021-1027`.

### 17. `selectSection` returns nothing; no validation

Mudlet returns boolean and rejects negative `from`. mudix records the selection unconditionally and returns `undefined`. Scripts using `if not selectSection(...)` always see `nil`. `ScriptingAPI.ts:594`.

### 18. `moveCursor` returns nothing; ignores `x` outside trigger context

- Returns `undefined` (Mudlet returns boolean).
- Outside trigger processing, `x` is ignored — only the line component is honored. `ScriptingAPI.ts:816-823`.

### 19. `moveCursorUp`/`Down` ignore `lines` and `keepHorizontal` overloads

Mudlet (via mudlet-lua/lua/GUIUtils.lua): `moveCursorUp([win,] [lines=1,] [keepHorizontal])`. mudix accepts only `windowName`. Calling `moveCursorUp(5)` is interpreted as `windowName="5"` and silently fails. `LuaRuntime.ts:773-774`.

### 20. `getLines` table is 0-indexed (Mudlet is 1-indexed)

JS array crosses the wasmoon boundary as a 0-indexed Lua table. `ipairs(t)` skips the first entry. Other primitives use a Bridge.lua `rebuildJsArray` wrapper for this; `getLines` doesn't. `LuaRuntime.ts:769-772`.

### 21. `createMiniConsole` parent is silently dropped

Mudlet's 6-arg form `(parent, name, x, y, w, h)` nests the miniconsole inside a userwindow. mudix accepts the parent arg but treats it as `main`. `ScriptingAPI.ts:849-866`.

### 22. `raiseLabel` / `lowerLabel` — wrong function name

Mudlet exposes `raiseWindow(labelName)` / `lowerWindow(labelName)` for both labels and userwindows. There is no `raiseLabel` / `lowerLabel` in Mudlet. Scripts written against Mudlet docs will get `attempt to call a nil value`. `LuaRuntime.ts:337-342`.

### 23. `setLabelClickCallback` doesn't pass an event table

Mudlet's click callback receives a `{button, x, y, …}` event table. mudix calls the callback with no args. Vararg trailing args are also dropped. Old cb id leaks in Lua registry on rebind. `LuaRuntime.ts:310-314`, `Bridge.lua:268-273`.

### 24. `sendCmdLine` semantics inverted

- Mudlet: stages text into the command bar (`setPlainText` + `selectAll`); does **not** submit.
- mudix: immediately sends the text to the MUD via `api.send`. `LuaRuntime.ts:901-903`.

### 25. Missing real label callbacks (browser supports them)

These are stubs but the DOM has full equivalents — should be promoted from `missing` to working bindings.

- `setLabelDoubleClickCallback` — DOM `dblclick`.
- `setLabelReleaseCallback` — DOM `mouseup`.
- `setLabelMoveCallback` — DOM `mousemove`.
- `setLabelWheelCallback` — DOM `wheel`.
- `setLabelOnEnter` — DOM `mouseenter`.
- `setLabelOnLeave` — DOM `mouseleave`.

`LuaRuntime.ts:396-401`. Used by Geyser gauges and many HUD packages.

### 26. Missing `setCmdLineAction` / `resetCmdLineAction`

Real Mudlet APIs that intercept Enter on the command bar. mudix declares them as stubs. Scripts that want a custom command parser fall through to default sending. `LuaRuntime.ts:402-403`.

### 27. Missing `setAppStyleSheet` / `setUserWindowStyleSheet`

Real Mudlet APIs that scripts (theme switchers, package CSS) depend on. Browser approximations exist (inject `<style>` into `document.head`, scope per-panel). Currently no-op stubs. `LuaRuntime.ts:363-378`.

### 28. `remainingTime` is a stub

Always returns `-1`. Mudlet returns seconds remaining on a scheduled timer. `LuaRuntime.ts:1048` (TODO).

---

## Per-category tables

### Output / formatting

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| echo | `echo([miniconsole|label,] text)` | `echo(a, b?)` | OK; label routing replaces HTML (matches Mudlet) | OK |
| fg | `fg([window], colorName)` | `fg(name)` (overwritten by GUIUtils.lua wrapper) | Dead JS binding, GUIUtils.lua provides full surface | OK |
| bg | `bg([window,] colorName)` | same pattern as `fg` | same | OK |
| setFgColor | `setFgColor([win], r, g, b)` | overload via `typeof a === 'string'` | No 0–255 validation; `Number()` coerces NaN silently | minor |
| setBgColor | `setBgColor([win], r, g, b, [alpha])` | 4-arg only | Drops optional alpha (4th arg in 4-num form / 5th in win form) | minor |
| setBold/Italics/Underline/StrikeOut | `set*([win,] bool)` | overload via first-arg type | OK; `!!a` coerces non-bool | OK |
| resetFormat | `resetFormat([win])` | adds selection-clearing layer | OK | OK |
| deselect | `deselect([win])` | ignores window arg (single global selection) | mudix has one global selection, not per-console | minor |
| insertText | `insertText([win,] text)` | overload by arg count | OK | OK |
| deleteLine | `deleteLine([win])` | OK | OK | OK |
| replace | `replace([win,] with, [keepcolor])` | 2-arg only | Drops `keepcolor` (3rd arg) | minor |
| echoLink | `echoLink([win,] text, cmd, hint, [useCurrentFmt])` | `hasWindow = typeof d === 'string'` | Drops `useCurrentFormat` (no Mudlet default blue+underline styling) | minor |
| **echoPopup** | `echoPopup([win,] text, {cmds}, {hints}, [useCurrentFmt])` | always 5-arg `(win, text, cmds, hints, fmt)` | Bridge.lua wrapper does NOT auto-detect no-window form — `echoPopup(text, {cmds}, {hints})` garbles args | **major** |
| **selectCaptureGroup** | `(groupNum|groupName)` | numeric only; named TODO | Named-group lookup unimplemented; numeric path uses `selectString` which picks the wrong occurrence when captured text repeats | **major** |
| printError | `printError(msg, [showStack], [haltExec])` | `(text)` only | Drops `showStackTrace` and `haltExecution` | minor |
| feedTriggers | `feedTriggers(text, [utf8=true])` | `(text)` only | Drops encoding flag (irrelevant in JS) | OK |

### Selection / cursor / line

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| selectString | `([win,] text, occurrence) → start col or -1` | same | OK | OK |
| **selectSection** | `([win,] from, length) → bool` | same; returns nothing | No bool return; no bounds validation | **major** |
| getSelection | `([win]) → text, start, length OR nil, errMsg` | `false, "no selection"` | Mudlet returns `nil, msg`; mudix returns `false, msg` | minor |
| isPrompt | reflects `promptBuffer[userCursorY]` | cached `_isPrompt` for last line only | Can't query historical lines via moveCursor + isPrompt | minor |
| getCurrentLine | `([win]) → string, [bad_window_value]` | string; `''` on missing | No error tuple | minor |
| **getLineNumber** | `([win]) → 0-indexed cursor.y` | `cursor + 1` | Off-by-one — mudix is 1-indexed | **major** |
| **getLineCount** | `([win]) → size - 1` (last index) | `history.length` (count) | Off-by-one | **major** |
| **getLastLineNumber** | `([win]) → size - 1`; -1 if missing | `history.length`; never -1 | Off-by-one + missing error sentinel | **major** |
| getColumnNumber | `([win]) → mUserCursor.x()` (persistent) | `cursorCol` only inside trigger; else 0 | Outside triggers always returns 0 | minor |
| getColumnCount | font-metric column count | DOM probe; returns 0 if not mounted | Equivalent for monospace | minor |
| setWindowWrap | `(name, wrapAt)` no return; name required | `([name,] n) → bool` | mudix returns bool and accepts no-name shorthand | minor |
| **getLines** | `([win,] from, to) → 1-indexed table` | JS array → 0-indexed Lua table | `ipairs` skips first entry; needs Bridge wrapper | **major** |
| **moveCursorUp** | `([win,] [lines=1,] [keepHoriz])` | `(win)` only | Calling `moveCursorUp(5)` interpreted as window name | **major** |
| **moveCursorDown** | `([win,] [lines=1,] [keepHoriz])` | `(win)` only | same | **major** |
| moveCursorEnd | `([win])` — last char of last line | `Console.moveTo(lineCount)` | No column cursor on rendered history | minor |
| **moveCursor** | `([win], x, y) → bool` | returns nothing; outside trigger ignores `x` | No bool return; column ignored on history | **major** |

### Windows / labels

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| windowType | string kind or `nil, errMsg` | "main"/"label"/"miniconsole"/"userwindow"/null | Missing "buffer", "commandline", "textedit"; null instead of `nil, msg` | minor |
| openUserWindow | `(name, [restoreLayout, autoDock, dockingArea]) → true` | returns WindowHandle object | Returns handle not `true`; force-defaults dockingArea to `'r'` | minor |
| openMapWidget | `([area\|x,y,w,h]) → true` | returns WindowHandle | 2-arg `(x, y)` form unsupported; missing `true` return | minor |
| clearUserWindow | `([name])` — defaults to main | requires name | No-arg call passes `undefined` to clear | minor |
| clearWindow | alias of clearUserWindow | OK | OK | OK |
| **createMiniConsole** | `([parent,] name, x, y, w, h)` — parent nests inside userwindow | accepts parent but ignores it | Parent silently dropped; nested miniconsoles unsupported | **major** |
| hideWindow | `(name)` — labels first, then sub-consoles | matches | OK | OK |
| showWindow | `(name) → bool` | no return | Missing bool return | minor |
| moveWindow | `(name, x, y)` — labels first | matches | OK | OK |
| resizeWindow | `(name, w, h)` — labels first | matches | OK | OK |
| setUserWindowTitle | `(name, [title]) → bool` — empty resets | requires title; no return | Title required; no bool | minor |
| setBackgroundColor | `([name,] r, g, b, [a]) → bool` | overload by first-arg type | No 0–255 validation; no bool return | minor |
| getBackgroundColor | `([name]) → r, g, b, a OR nil, errMsg` | always returns 4 ints (zeroes on miss) | Missing windows return zeros instead of `nil, errMsg` | minor |
| createLabel | `([parent,] name, x, y, w, h, fillBg, [clickThrough])` | overload by 2nd-arg type | OK; `!!` coerces non-bool args (Mudlet errors) | minor |
| deleteLabel | `(name) → true OR false, errMsg` | returns bool | No errMsg | minor |
| setLabelStyleSheet | Qt CSS | DOM CSS via cssRewriter | Qt-specific selectors (`QLabel::hover`) need rewriter support | minor |
| **setLabelClickCallback** | `(name, fn|nil, [args...])`; fn receives event table | no event arg, no varargs, can't pass nil to clear | Click handlers reading `event.button` see nil; cb id leak on rebind | **major** |
| setLabelToolTip | `(name, text, [duration]) → bool` | duration ignored | No duration; no bool | minor |
| resetLabelToolTip | `(name)` | matches | OK | OK |
| enableClickthrough | `(name)` | matches | OK | OK |
| disableClickthrough | `(name)` | matches | OK | OK |
| **raiseLabel** | doesn't exist; Mudlet has `raiseWindow(labelName)` | mudix-only name | Wrong global name; scripts get nil-call error | **major** |
| **lowerLabel** | doesn't exist; Mudlet has `lowerWindow(labelName)` | mudix-only name | same | **major** |
| setLabelCursor | `(name, shapeInt) → bool`; GUIUtils.lua wraps strings | int only | Relies on bundled GUIUtils.lua wrapper for strings | minor |
| resetLabelCursor | `(name)` | matches | OK | OK |
| **setAppStyleSheet** | `(css, [tag]) → true`; raises sysAppStyleSheetChange | no-op stub | Theme-switcher packages depend on this | **missing** |
| **setUserWindowStyleSheet** | `(name, css) → bool` | no-op stub | Per-window CSS (achievable via dockview panel scoping) | **missing** |
| **setLabelDoubleClickCallback** | label dblclick callback | no-op stub | DOM `dblclick` available | **missing** |
| **setLabelReleaseCallback** | label mouseup callback | no-op stub | DOM `mouseup` available | **missing** |
| **setLabelMoveCallback** | label mousemove callback | no-op stub | DOM `mousemove` available | **missing** |
| **setLabelWheelCallback** | label wheel callback | no-op stub | DOM `wheel` available | **missing** |
| **setLabelOnEnter** | label mouseenter callback | no-op stub | DOM `mouseenter` available | **missing** |
| **setLabelOnLeave** | label mouseleave callback | no-op stub | DOM `mouseleave` available | **missing** |

### Mapper

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| centerview | `(roomID)` | matches | OK | OK |
| getRoomIDbyHash | returns -1 if not found | returns false | `false` vs `-1` | minor |
| setRoomIDbyHash | matches | OK | OK | OK |
| getRoomHashByID | string or `(false, errMsg)` | string or false | No errMsg | minor |
| loadMap | `([location])` — accepts `.dat`/`.xml` | `.dat` only | No XML import | minor |
| createRoomID | `([minimum])` | no args | Drops optional `minimum` | minor |
| **addRoom** | `(roomID, areaID) → bool` | `(roomID)` only | Drops `areaID` — room not assigned to area | **major** |
| deleteRoom | `(roomID) → bool` | no return | Missing bool | minor |
| roomExists | `(roomID) → bool` | matches | OK | OK |
| getRoomName | string or `(false, errMsg)` | string or false | No errMsg | minor |
| setRoomName | matches; no return | matches | minor |
| getRoomArea | number | number or false | `false` on miss | minor |
| **setRoomArea** | `(roomID|{ids}, areaID|areaName) → bool` | `(id, areaId)` number-only | Rejects name string and array of room IDs | **major** |
| getRoomCoordinates | `x, y, z` (3 returns) | Bridge unpacks JS `[x,y,z]` | OK | minor |
| setRoomCoordinates | matches; bool | no return | Missing bool | minor |
| getRoomsByPosition | 0-indexed table | 0-indexed via wasmoon | OK | OK |
| getRoomEnv | number | number (0 on miss) | 0 instead of error | minor |
| setRoomEnv | matches | matches | minor |
| getRoomChar | string | `''` on miss | `''` instead of error | minor |
| setRoomChar | matches | matches | minor |
| getRoomUserData | `(id, key, [fullErr])` | `(id, key)` | Missing fullErr flag | minor |
| setRoomUserData | matches; bool | no return | Missing bool | minor |
| getMapUserData | string or `(false, errMsg)` | `''` on miss | Different miss-shape | minor |
| setMapUserData | matches | matches | OK | OK |
| **clearMapUserData** | no args; clears entire dict | `(key)` — clears single key | **Wrong semantics**: clears single key (this is `clearMapUserDataItem` in Mudlet) | **major** |
| getAllMapUserData | matches | matches | OK | OK |
| getRoomExits | `{[dir]=roomID}` | matches | OK | OK |
| **setExit** | `(from, to, dir)` — dir is string OR int | int only | Rejects "north"/"n"; no bool return | **major** |
| getExitStubs | 0-indexed table | 0-indexed | OK | OK |
| **setExitStub** | `(roomID, dir, set)` — dir is string OR int | int only | Rejects string direction | **major** |
| addSpecialExit | matches; bool | no return | Missing bool | minor |
| removeSpecialExit | matches; bool | no return | Missing bool | minor |
| getSpecialExitsSwap | `{[cmd]=toRoomID}` | matches | OK | OK |
| getDoors | `{[dir]=status}` | matches | OK | OK |
| setDoor | `(roomID, exitCmd, status) → bool` — validates exit | no validation, no return | Skips Mudlet exit-existence check | minor |
| addMapEvent | no return | bool | Extra return shouldn't break | minor |
| removeMapEvent | no return | bool | same | minor |
| **getMapEvents** | `{[unique]={["event name"]=, ["parent"]=, ["display name"]=, ["arguments"]={...}}}` | `{event=, parent=, display=, args=}` | Wrong field names | **major** |
| setCustomEnvColor | `(envID, r, g, b, a)` | matches; alpha stored, renderer uses RGB | minor |
| getCustomEnvColor | not in Mudlet (Mudlet has `getCustomEnvColorTable`) | mudix-only | Non-canonical accessor | minor |
| **addAreaName** | `→ areaID OR (false, errMsg)` on dup | returns existing ID on dup | Masks duplicate-name conflict | **major** |
| **deleteArea** | `(areaID|areaName) → bool` | number-only, no return | Rejects name; no bool; deletes contained rooms (Mudlet moves them to default) | **major** |
| getAreaTable | `{[name]=id}` | matches | OK | OK |
| **getRoomAreaName** | `(areaID|areaName)` — bidirectional | number-only | Rejects string lookup | **major** |
| **setAreaName** | `(areaID|areaName, newName) → bool` | number-only | Rejects name lookup; no return | **major** |
| getAreaRooms | 0-indexed table | matches | OK | OK |
| getRooms | `{[id]=name}` | matches | OK | OK |

### Triggers / aliases / timers / scripts / packages / modules

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| tempTimer | `(seconds, code|fn, [repeating])` → id | matches | OK | OK |
| tempAlias | `(regex, code|fn)` | matches | OK | OK |
| tempTrigger | **substring-match** | regex (PCRE) | Wrong match semantics | **major** |
| **tempRegexTrigger** | regex match | regex | shares primitive — OK for this name | (counted under tempTrigger) |
| **tempKey** | `([modifier,] keyCode, fn)` — modifier optional; keyCode is Qt::Key int | `(modifier, key, fn)` requires 3 args; numeric key gets stringified | Modifier required; numeric Qt::Key codes don't translate | **major** |
| **killTimer** | `(id|name) → bool` | numeric id only | Mudlet accepts name strings | **major** |
| **killAlias** | `(name) → bool` | numeric id | wrong arg type | **major** |
| **killTrigger** | `(id|name) → bool` | numeric id | same | **major** |
| **killKey** | `(name) → bool` | numeric id | same | **major** |
| enableTrigger/disableTrigger/enableTimer/disableTimer | `(name) → bool` | matches | OK | OK |
| enableScript/disableScript | `(name) → true` (errors if missing) | bool (false if missing) | mudix doesn't raise | minor |
| exists | `(name|id, type) → count` | name+type only | No id-form lookup; accepts both `key` and `keybind` | minor |
| **permScript** | `(name, parent, code) → numeric id` | UUID string | Return type mismatch | **major** |
| **permRegexTrigger** | `(name, parent, regexes, code) → numeric id` | UUID string | same; also empty regex list creates folder (Mudlet rejects) | **major** |
| **setScript** | `(name, code, [pos]) → numeric id` | `true` or `-1` | Wrong return type | **major** |
| installPackage | `(location)` — http URLs via Other.lua | VFS path only (Other.lua override may handle URLs) | Verify Other.lua override is loaded | minor |
| uninstallPackage | `(name) → true | nil` | bool | `false` vs `nil` | minor |
| getPackages | 1-indexed table | Bridge rebuilds | OK | OK |
| installModule | `(location) → true` | bool | minor | minor |
| uninstallModule | matches | matches | OK | OK |
| reloadModule | no return | bool | extra bool ignored | minor |
| syncModule | not in Mudlet's canonical Lua API | fire-and-forget alias for force-flush | mudix-specific | minor |
| enableModuleSync/disableModuleSync | `→ true | warn` | void | No return | minor |
| getModuleSync | `→ bool | warn` | bool (false on missing) | mudix silent on missing | minor |
| setModulePriority | no return; errors on unknown | bool | mudix silent on unknown | minor |
| getModulePriority | number; errors on unknown | 0 on unknown | mudix silent | minor |
| getModules | 1-indexed | Bridge rebuilds | OK | OK |
| getModuleInfo | table or string | matches | empty-table vs nil on unknown | minor |
| raiseEvent | `→ true`; supports tables/functions via registry refs | no return | Loses bool; table args pass through wasmoon conversion | minor |
| registerAnonymousEventHandler | `→ numeric id` | stub returns 0; mudlet-lua/Other.lua overrides | OK once Other.lua loads | minor |
| showHandlerError | logs via host.mLuaInterpreter | `printError("[event \"…\"] …")` | parallel | OK |
| expandAlias | `(cmd, [echo=true])` (nil echo → false) | `echo ?? true` (nil → true) | nil-echo handling differs; no `true` return | minor |
| denyCurrentSend | sets gate flag | matches | OK | OK |
| **sendCmdLine** | stages text in cmdbar (no submit) | calls `api.send` (immediate transmit) | **Inverted semantics** | **major** |
| send | `(cmd, [echo=true]) → true` | no return | Missing return | minor |
| sendGMCP | `(message, [what])` | drops 2nd arg | Missing optional `what` | minor |
| saveProfile | `([location, [filename]]) → (true, filename) | (nil, errMsg)` | always `(true, path)` | Never reports failure; ignores location and filename | minor |
| unzipAsync | matches | matches | OK | OK |
| **remainingTime** | `(id|name) → seconds` | stub returns -1 | TODO | **missing** |
| **selectCaptureGroup** | numeric AND named | numeric only (off-by-one risk if capture repeats); named TODO | see "Top priorities" #6 | **major** |

### Network / HTTP / cmdline

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| getNetworkLatency | seconds float | `(ping ?? 0) / 1000` | OK; returns 0 instead of last when not measured | minor |
| downloadFile | `(saveTo, url) → (true, url)` | no return tuple; `sysDownloadDone` empty 3rd arg | Missing return tuple | minor |
| getHTTP | `(url, headers) → (true, url)` | no return | Missing return | minor |
| postHTTP | `(data, url, headers, file) → (true, url)` | matches; file via VFS | Missing return | minor |
| putHTTP | `(data, url, [headers, file]) → (true, url)` | same | Missing return | minor |
| deleteHTTP | `(url, headers) → (true, url)` | no return | Missing return | minor |
| customHTTP | C++: `(method, data, url, headers, file)` | `(method, data, url, headers)` | Missing optional `file` arg; no return | minor |
| appendCmdLine | `([name,] text)` | name dropped (single bar) | OK | OK |
| printCmdLine | `([name,] text)` | name dropped | OK | OK |
| clearCmdLine | `([name])` | name dropped | OK | OK |
| **addCommandLineMenuEvent** | `([cmdLineName,] menuLabel, eventName)` — **no displayName** | introduces phantom `displayName` slot | Wrong arg semantics | **major** |
| removeCommandLineMenuEvent | `([cmdLineName,] menuLabel) → bool` | drops cmdLineName | Mudlet returns `(false, msg)` on missing | minor |
| getCommandLineMenuEvents | not in Mudlet C++ | mudix-only | OK as extension | OK |
| **setCmdLineAction** | `(cmdLineName, fn, [args...])` — intercepts Enter | no-op stub | Real Mudlet API; scripts that intercept Enter silently fail | **missing** |
| **resetCmdLineAction** | `(cmdLineName) → bool` | no-op stub | same | **missing** |
| openWebPage | `(url) → bool` | `window.open(url, '_blank')` | Missing bool return | minor |
| debugc | single arg, routes to error-info console | variadic, routes to devtools | minor | minor |
| errorc | `(content, [debugInfo])` | variadic to script log | minor | minor |

### Borders / fonts / sizes / version / misc

| Function | Mudlet signature | mudix accepts | Discrepancy | Severity |
|---|---|---|---|---|
| setBorderTop/Bottom/Left/Right | `(size)` | matches | OK | OK |
| **setBorderSizes** | 1/2/3/4 args (uniform / vertical-horizontal / top-h-bottom / TRBL) | 1 and 4 only | Missing 2- and 3-arg forms | **major** |
| getBorderTop/Bottom/Left/Right/Sizes | matches | matches | OK | OK |
| setBorderColor | `(r,g,b)` (alpha forced 255) | accepts optional alpha | mudix accepts alpha Mudlet ignores; no 0-255 validation | minor |
| resetBorderColor | doesn't exist in Mudlet | mudix extension | OK | OK |
| setFontSize | `([name,] size)` size>0; pointSize; `→ true \| nil, errMsg` | clamps 1..99; CSS px; bool | Different unit; `false` vs `(nil, msg)` | minor |
| getFontSize | `([name])` int pointSize or nil | CSS px; `false` on missing | Unit + miss-shape differ | minor |
| setFont | `([name,] family)` `→ true \| nil, errMsg` if unavailable | always succeeds on main; bool | No font-availability check | minor |
| getFont | `([name])` string family | string or false | `false` for missing window | minor |
| getMainWindowSize | console-only area (excludes toolbars) | viewport rect | Reports viewport, not console area | minor |
| getUserWindowSize | size or main-console fallback for missing | (0,0) on missing | Different miss-shape | minor |
| **getMudletVersion** | `"table"` mode → 4 returns `(M, m, r, build)` | 3 returns | Drops `build` | **major** |
| getProfileName | host profile dir name | connection display name | Semantically close, not identical | minor |
| getEpoch | seconds with sub-second precision | `Date.now()/1000` | OK | OK |

---

## What was excluded from audit

- **Pure-Lua wrappers in bundled `mudlet-lua/`**: `cecho`, `decho`, `hecho`, `xEcho`, `cinsertText`, `creplace`, `cechoLink`, `decho2cecho`, etc. They're verbatim Mudlet code and only fail if a primitive (`setFgColor`, `setBgColor`, `insertText`, `deleteLine`, `selectString`) is broken. The primitives are audited above.
- **`mudlet-lua/lua/StringUtils.lua` / `TableUtils.lua` / `DB.lua` / `DateTime.lua` / `GeyserGeyser.lua` / etc.** — bundled verbatim.
- **GMCP / MSSP / MCMP / Discord / TTS** — not present in mudix's binding surface; deliberately scoped out.
- **`auditAreas`, `searchRoom`, `searchAreaUserData`, `getMapMenus`, `addMapMenu`, ...** — many less-common mapper APIs are not exposed by mudix; they are missing-feature items, not behavior bugs, and weren't in the agent's scope.

Use this report as input to a follow-up plan: each major + missing item maps to a discrete fix.
