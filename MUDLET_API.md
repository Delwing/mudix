# Mudlet API Implementation Checklist

Status legend:
- ✅ Implemented and callable from Lua (either JS-bound or pure Lua whose dependencies are all satisfied)
- 🚧 Feasible — worth implementing
- ⚠️ Partial — skeleton exists, signature is incomplete, or pure-Lua impl is bundled but blocked by a missing dependency
- ❌ N/A — fundamentally inapplicable (multi-profile, subprocess, Discord SDK, IRC, etc.)

> Many APIs become "free" as soon as a single primitive is added. The known blockers right now:
> - `createCommandLine` — blocks `Geyser.CommandLine` and the whole overlay command-line widget family.
> - `insertPopup` / `setPopup` — block `cinsertPopup`/`dinsertPopup`/`hinsertPopup`.
> - `getLabelStyleSheet` — blocks `getLabelFormat` returning correct values.
> - `getPath` — blocks pathfinding-aware speedwalk (the runner itself works).

---

## Architecture Notes

### Overlay UI system
`createMiniConsole`, `createLabel`, `createGauge`, `createCommandLine` and friends will be implemented as **absolutely-positioned HTML elements** rendered in an overlay layer on top of the main output area. This mirrors how Mudlet lays them out: pixel coordinates within the client window.

- `moveWindow(name, x, y)` and `resizeWindow(name, w, h)` apply to overlay elements via CSS `left`/`top`/`width`/`height`.
- Dockview panels (opened via `openWindow`) follow dockview's own layout and are not absolutely positioned — `moveWindow`/`resizeWindow` do not apply to them.
- `showWindow`/`hideWindow` and `raiseWindow`/`lowerWindow` apply to both overlay elements (CSS `display`/`z-index`) and dockview panels.

### Virtual filesystem
A virtual filesystem (IndexedDB-backed, similar to the existing `mapStorage`) will provide path-based file I/O from Lua. This enables:
- `table.save` / `table.load`
- `io.exists`
- `getMudletHomeDir()` → returns the VFS root path
- `saveMap(path)` / `loadMap(path)`
- `downloadFile(url, path)` → fetch + write to VFS
- Sound file playback from VFS paths

### Geyser
A subset of the Geyser OOP framework (`Container`, `Label`, `MiniConsole`, `Gauge`, `HBox`, `VBox`) can be implemented in pure Lua on top of the overlay element API — no additional JS needed once the primitives exist.

---

## Output / Display

| Function | Status | Notes |
|---|---|---|
| `echo([window,] text)` | ✅ | Main window; window arg routes to overlay/panel |
| `cecho([window,] text)` | ✅ | `<colorname>text` syntax |
| `decho([window,] text)` | ✅ | `<r,g,b>text` syntax |
| `hecho([window,] text)` | ✅ | `#RRGGBBtext` syntax |
| `print(...)` | ✅ | Alias for echo |
| `display(value)` | ✅ | Pretty-prints tables recursively |
| `feedTriggers(text)` | ✅ | Feeds text through trigger pipeline + shows in output |
| `cfeedTriggers(text)` | ✅ | Pure Lua via GUIUtils.lua, wraps `feedTriggers` |
| `dfeedTriggers(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hfeedTriggers(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `deleteLine()` | ✅ | Removes last output element |
| `prefix(text)` | ✅ | Pure Lua via GUIUtils.lua (moveCursor + insertText) |
| `suffix(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `replace(text)` | ✅ | JS-exposed |
| `replaceLine(text)` | ✅ | Pure Lua via GUIUtils.lua (selectCurrentLine + replace) |
| `creplace(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `dreplace(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hreplace(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `insertText([window,] text)` | ✅ | JS-exposed |
| `cinsertText([window,] text)` | ✅ | Pure Lua via GUIUtils.lua (`xEcho` → insertText) |
| `wrapLine([window,] linenum)` | 🚧 | Re-wrap a line |
| `scrollUp([window,] lines)` | ✅ | Pure Lua via GUIUtils.lua |
| `scrollDown([window,] lines)` | ✅ | Pure Lua via GUIUtils.lua |
| `showColors([columns])` | ✅ | Pure Lua via GUIUtils.lua |
| `showCaptureGroups()` | ✅ | Pure Lua via DebugTools.lua (uses `matches` global) |
| `announce(text [, processing])` | ✅ | ARIA live region; `processing` (`importantall`/`importantmostrecent` → assertive, else polite) matches Mudlet's politeness mapping |

---

## Text Selection & Cursor

| Function | Status | Notes |
|---|---|---|
| `selectString([window,] text, n)` | ✅ | JS-exposed |
| `selectSection([window,] col, len)` | ✅ | JS-exposed |
| `selectCaptureGroup(n)` | ✅ | JS-exposed |
| `selectCurrentLine([window])` | ✅ | JS-exposed |
| `deselect([window])` | ✅ | JS-exposed |
| `getSelection([window])` | ✅ | Bridge.lua wraps `__getSelection` |
| `moveCursor([window,] x, y)` | ✅ | JS-exposed |
| `moveCursorEnd([window])` | ✅ | JS-exposed (plus `moveCursorUp`/`Down` in GUIUtils.lua) |
| `getLineNumber([window])` | ✅ | JS-exposed |
| `getColumnNumber([window])` | ✅ | JS-exposed |
| `getLineCount([window])` | ✅ | JS-exposed |
| `getLastLineNumber([window])` | ✅ | JS-exposed |
| `getCurrentLine([window])` | ✅ | Bridge.lua wraps `__getCurrentLine` |
| `getLines([window,] from, to)` | ✅ | Bridge.lua wraps `__getLines` |
| `getRowCount([window])` | ✅ | JS-exposed |
| `getColumnCount([window])` | ✅ | JS-exposed |

---

## Text Formatting & Color

| Function | Status | Notes |
|---|---|---|
| `fg([window,] colorname)` | ✅ | Set foreground color by name |
| `bg([window,] colorname)` | ✅ | Set background color by name |
| `resetFormat([window])` | ✅ | Reset all formatting |
| `setFgColor([window,] r, g, b)` | ✅ | JS-exposed |
| `setBgColor([window,] r, g, b)` | ✅ | JS-exposed |
| `setHexFgColor([window,] hex)` | ✅ | Pure Lua via GUIUtils.lua → setFgColor |
| `setHexBgColor([window,] hex)` | ✅ | Pure Lua via GUIUtils.lua → setBgColor |
| `setBold([window,] bool)` | ✅ | JS-exposed |
| `setItalics([window,] bool)` | ✅ | JS-exposed |
| `setUnderline([window,] bool)` | ✅ | JS-exposed |
| `setStrikeOut([window,] bool)` | ✅ | JS-exposed |
| `setReverse([window,] bool)` | ✅ | Toggle reverse video — sets `FormatState.inverse` on pen + selection (renderer swaps fg/bg) |
| `setTextFormat([window,] ...)` | 🚧 | Set all formatting in one call |
| `getTextFormat([window])` | 🚧 | Get current formatting |
| `setCommandBackgroundColor([window,] r,g,b[,a])` | ✅ | Patches the `inputBackground` profile field (rgba 0..255 → CSS). Main bar only; non-"main" window ignored |
| `setCommandForegroundColor([window,] r,g,b[,a])` | ✅ | Patches the `inputForeground` profile field. Main bar only |
| `setBackgroundColor([window,] r,g,b,a)` | ✅ | JS-exposed |

---

## Color Conversion Utilities

All of these are pure text-transformation functions implementable in Lua/JS with no platform dependencies.

| Function | Status | Notes |
|---|---|---|
| `cecho2ansi(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2decho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2hecho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2html(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2ansi(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2cecho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2hecho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2html(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hecho2ansi(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hecho2cecho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hecho2decho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hecho2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hecho2html(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `ansi2decho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `ansi2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `closestColor(r, g, b)` | ✅ | Pure Lua via GUIUtils.lua |
| `getFgColor([window])` | ✅ | Bridge.lua → `__getFgColor`; reads color at selection start, falls back to profile default when the segment carries no explicit color |
| `getBgColor([window])` | ✅ | Bridge.lua → `__getBgColor`; same semantics — distinct from window-background `getBackgroundColor` |
| `color_table` | ✅ | Named color → {r,g,b} table (GUIUtils.lua) |

---

## Clickable Links & Popups

| Function | Status | Notes |
|---|---|---|
| `echoLink([window,] text, cmd, hint)` | ✅ | JS-exposed; Bridge.lua maps function `cmd` to a callback id |
| `cechoLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua (`xEcho` → echoLink) |
| `dechoLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `hechoLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `insertLink([window,] text, cmd, hint)` | ✅ | JS-exposed; Bridge.lua maps function `cmd` to a callback id (same wrapper as `echoLink`) |
| `cinsertLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua (`xEcho` → insertLink) |
| `dinsertLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `hinsertLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `echoPopup([window,] text, cmds, hints)` | ✅ | JS-exposed; Bridge.lua flattens cmds/hints tables |
| `cechoPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `dechoPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `hechoPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `insertPopup([window,] text, cmds, hints)` | 🚧 | Insert popup at cursor — primitive missing (blocks `cinsertPopup`/`dinsertPopup`/`hinsertPopup`) |
| `setLink([window,] cmd, hint)` | ✅ | JS-exposed; Bridge.lua maps function `cmd` to a callback id |
| `setPopup([window,] cmds, hints)` | 🚧 | Make selection a popup |

---

## Command Input

| Function | Status | Notes |
|---|---|---|
| `send(text [, echo])` | ✅ | Send command to MUD |
| `sendAll(text1, text2, ...)` | ✅ | Send multiple commands at once (Other.lua) |
| `expandAlias(text [, echo])` | ✅ | JS-exposed (`ScriptingAPI.expandAlias`) |
| `denyCurrentSend()` | ✅ | JS-exposed; cancels the currently-dispatched send |
| `appendCmdLine(text)` | ✅ | Append text to main command bar |
| `setCmdLine(text)` | ✅ | Set main command bar text (`sendCmdLine`/`printCmdLine`) |
| `getCmdLine([name])` | ✅ | JS-exposed; reads the live main bar or a named overlay command line |
| `clearCmdLine([name])` | ⚠️ | JS-exposed but only operates on the main command bar; named overlay widgets not yet wired |
| `feedTelnet(data)` | 🚧 | Feed raw telnet bytes into pipeline |

---

## Aliases

| Function | Status | Notes |
|---|---|---|
| `tempAlias(pattern, code)` | ✅ | Temporary Lua regex alias |
| `killAlias(id)` | ✅ | Delete temp alias by ID |
| `permAlias(name, parent, pattern, code)` | ⚠️ | Permanent aliases exist in store; no Lua creation API yet |
| `enableAlias(name)` | ✅ | Enable permanent alias by name |
| `disableAlias(name)` | ✅ | Disable permanent alias by name |
| `exists(name, type)` | ✅ | JS-exposed (`ScriptingAPI.exists`) |
| `isActive(name, type [, checkAncestors])` | ✅ | Count active items by name/id; `checkAncestors` requires ancestor groups enabled too |

---

## Triggers

| Function | Status | Notes |
|---|---|---|
| `tempTrigger(pattern, code)` | ✅ | Temporary substring/regex trigger |
| `killTrigger(id)` | ✅ | Delete temp trigger by ID |
| `tempRegexTrigger(pattern, code)` | ✅ | Bridge.lua wraps `__mudix_tempRegexTrigger` |
| `tempBeginOfLineTrigger(pattern, code)` | ✅ | Literal prefix (`String.prototype.startsWith`), NOT regex `^` — matches Mudlet's `match_begin_of_line_substring` |
| `tempExactMatchTrigger(pattern, code)` | ✅ | Full-line exact match |
| `tempColorTrigger(fg, bg, code)` | 🚧 | Match on ANSI color in line |
| `tempLineTrigger(from, count, code)` | 🚧 | Fire on N consecutive lines |
| `tempPromptTrigger(code)` | ✅ | Bridge.lua wraps `__mudix_tempPromptTrigger`; fires on lines flagged as a prompt (GA/EOR). expirationCount honoured |
| `permRegexTrigger(name, parent, pattern, code)` | ⚠️ | `__mudix_permRegexTrigger`/`permRegexTrigger` exist; full Lua API still limited |
| `permSubstringTrigger(name, parent, pattern, code)` | ⚠️ | Same |
| `enableTrigger(name)` | ✅ | JS-exposed |
| `disableTrigger(name)` | ✅ | JS-exposed |
| `killTrigger(name)` | 🚧 | Delete named permanent trigger (numeric-ID form ✅) |
| `setTriggerStayOpen(name, lines)` | 🚧 | Keep trigger active for N extra lines |

---

## Timers

| Function | Status | Notes |
|---|---|---|
| `tempTimer(delay, code [, repeat])` | ✅ | One-shot or repeating timer |
| `killTimer(id)` | ✅ | Delete timer by ID |
| `permTimer(name, parent, delay, code)` | ⚠️ | Permanent timers exist; no Lua creation API yet |
| `enableTimer(name)` | ✅ | JS-exposed |
| `disableTimer(name)` | ✅ | JS-exposed |
| `remainingTime(id)` | ✅ | JS-exposed |

---

## Keybindings

| Function | Status | Notes |
|---|---|---|
| `tempKey(modifier, key, code)` | ✅ | Temporary keybinding |
| `killKey(id)` | ✅ | Delete keybinding by ID |
| `permKey(name, parent, modifier, key, code)` | ⚠️ | Permanent keybindings exist; no Lua creation API yet |
| `enableKey(name)` | ✅ | Enable keybindings (and groups) matching name; cascades to children |
| `disableKey(name)` | ✅ | Disable keybindings (and groups) matching name; cascades to children |

---

## Stopwatches

| Function | Status | Notes |
|---|---|---|
| `createStopWatch([name], [autostart])` | ✅ | `performance.now()`-based high-res stopwatch (`StopwatchManager`). Accepts watchID or name everywhere. Named watches default autostart off |
| `startStopWatch(id\|name [, resetAndRestart])` | ✅ | Bare numeric id resets+restarts (legacy); name form resumes |
| `stopStopWatch(id\|name)` | ✅ | Returns elapsed seconds |
| `resetStopWatch(id\|name)` | ✅ | Zeroes elapsed; a running watch keeps running |
| `getStopWatchTime(id\|name)` | ✅ | Elapsed seconds without stopping |
| `adjustStopWatch(id\|name, seconds)` | ✅ | Add (or subtract) seconds |
| `deleteStopWatch(id\|name)` | ✅ | |
| `getStopWatches()` | ✅ | Bridge.lua re-keys to integer ids → `{ name, isRunning, isPersistent, elapsedTime }` |
| `setStopWatchPersistence(id\|name, state)` | ✅ | Persistent watches saved to localStorage (per connection) and restored on reload; a running one keeps counting across reloads. Uses wall-clock `Date.now()` |

---

## Events

| Function | Status | Notes |
|---|---|---|
| `raiseEvent(name, ...)` | ✅ | Fire custom Lua event |
| `registerAnonymousEventHandler(name, fn)` | ✅ | Other.lua override tracks IDs in `handlerIdsToHandlers` |
| `killAnonymousEventHandler(id)` | ✅ | Other.lua: removes handler by ID |
| `mudix.on(event, fn)` | ✅ | Mudix-native registration |
| `mudix.off(event, fn)` | ✅ | Mudix-native deregistration |
| `registerNamedEventHandler(name, event, code)` | ✅ | IDManager.lua (built on `registerAnonymousEventHandler`) |
| `deleteNamedEventHandler(name)` | ✅ | IDManager.lua |
| `stopNamedEventHandler(name)` | ✅ | IDManager.lua |
| `resumeNamedEventHandler(name)` | ✅ | IDManager.lua |
| `raiseGlobalEvent(name, ...)` | ❌ | Multi-profile only |

### System Events (fired to Lua by the client)

| Event | Status | Notes |
|---|---|---|
| `sysConnect` / `connect` | ✅ | |
| `sysDisconnect` / `disconnect` | ✅ | |
| `sysGmcpMessage` / `gmcp` | ✅ | Per GMCP packet |
| `output` | ✅ | Per output line |
| `sysDataSendRequest` | 🚧 | Before each send — can deny |
| `sysWindowResizeEvent` | 🚧 | On main window resize |
| `sysLoadEvent` | 🚧 | Scripts initialized |
| `sysInstall` / `sysInstallPackage` | ✅ | After package install — arg: package name |
| `sysUninstall` / `sysUninstallPackage` | ✅ | Before package uninstall — arg: package name |
| `sysPathChanged` | 🚧 | Virtual FS file change watch |
| `sysSpeedwalkFinished` | 🚧 | After speedwalk completes |
| `sysUserWindowCreated` | 🚧 | After overlay element is created |
| `sysUserWindowClosed` | 🚧 | After overlay element is closed |
| `sysDownloadDone` | 🚧 | After downloadFile completes |
| `sysDownloadError` | 🚧 | After downloadFile fails |
| `sysGetHttpDone` | 🚧 | After getHTTP completes |
| `sysGetHttpError` | 🚧 | After getHTTP fails |
| `sysPostHttpDone` | 🚧 | After postHTTP completes |
| `sysMapperLocationChanged` | 🚧 | When player position in mapper changes |

---

## GMCP / Telnet Protocols

| Function | Status | Notes |
|---|---|---|
| `gmcp` table | ✅ | Auto-populated from incoming GMCP packets |
| `sendGMCP(message)` | ✅ | JS-exposed (frames as IAC SB GMCP …) |
| `sendMSDP(var, ...)` | 🚧 | MSDP variable request |
| `sendSocket(data)` | 🚧 | Send raw bytes over socket |
| `getConnectionInfo()` | ✅ | Bridge.lua unpacks `__getConnectionInfo` → host, port, connected (mud-mode config or parsed websocket URL) |
| `getNetworkLatency()` | ✅ | JS-exposed |
| `connectToServer(host, port)` | 🚧 | Connect from Lua |
| `disconnect()` | ⚠️ | JS-side method exists on `ScriptingAPI`; not bound as a top-level Lua global yet |
| `addSupportedTelnetOption(option)` | 🚧 | Advertise a custom telnet option via the WebSocket proxy |
| `sendATCP(msg)` | ❌ | Legacy protocol, no plans |

---

## HTTP Requests

| Function | Status | Notes |
|---|---|---|
| `getHTTP(url [, headers])` | ✅ | Bridge.lua → `HttpService.getHTTP`; fires `sysGetHttpDone`/`sysGetHttpError` |
| `postHTTP(url, data [, headers])` | ✅ | Bridge.lua → `HttpService.postHTTP` |
| `putHTTP(url, data [, headers])` | ✅ | Bridge.lua → `HttpService.putHTTP` |
| `deleteHTTP(url [, headers])` | ✅ | Bridge.lua → `HttpService.deleteHTTP` |
| `downloadFile(url, path)` | ✅ | Bridge.lua → `HttpService.downloadFile`, writes to profile VFS |

---

## Windows / Consoles

| Function | Status | Notes |
|---|---|---|
| `openWindow(id, options)` | ✅ | Opens a dockable panel (text/html/map) |
| `closeWindow(id)` | ✅ | Closes a panel |
| `clearWindow(id)` | ✅ | Clears panel content |
| `mudix.windows.write(id, text)` | ✅ | Write ANSI text to a panel |
| `mudix.windows.setTitle(id, title)` | ✅ | Set panel tab title |
| `mudix.windows.has(id)` | ✅ | Check if panel exists |
| `mudix.windows.focus(id)` | ✅ | Focus a panel |
| `showWindow(name)` | ✅ | JS-exposed |
| `hideWindow(name)` | ✅ | JS-exposed |
| `raiseWindow(name)` | ✅ | JS-exposed (CSS `z-index` on labels via `raiseLabel`/`lowerLabel`) |
| `lowerWindow(name)` | ✅ | JS-exposed |
| `moveWindow(name, x, y)` | ✅ | JS-exposed |
| `resizeWindow(name, w, h)` | ✅ | JS-exposed |
| `createMiniConsole(name, x, y, w, h)` | ✅ | JS-exposed |
| `createMapper([parent,] x, y, w, h)` | ✅ | JS-exposed; singleton embedded mapper widget that shares MapStore with the dock widget |
| `createLabel(name, x, y, w, h, passthrough)` | ✅ | JS-exposed |
| `createGauge(name, x, y, w, h, parent)` | ✅ | Pure Lua via GUIUtils.lua (3× `createLabel` + `setBackgroundColor`) |
| `createCommandLine(name, x, y, w, h)` | 🚧 | Absolutely-positioned extra input widget |
| `createBuffer(name)` | 🚧 | Off-screen text buffer (no position) |
| `appendBuffer(name)` | 🚧 | Paste buffer content into a window |
| `echoUserWindow(name, text)` | ✅ | Alias for `mudix.windows.write` |
| `deleteMiniConsole(name)` | ✅ | JS-exposed; closes the panel via `WindowManager.close`. Rejects non-miniconsole targets (CONSOLE-only, matches Mudlet) |
| `deleteLabel(name)` | ✅ | Bridge.lua → `__deleteLabel` |
| `deleteCommandLine(name)` | 🚧 | Remove overlay command line |
| `setConsoleBufferSize([window,] linesLimit [, batchSize])` | ✅ | Scrollback size limit — maps to `Console.setMaxLines`; batch size round-tripped |
| `getConsoleBufferSize([window])` | ✅ | Bridge.lua unpacks `__getConsoleBufferSize` → linesLimit, batchSize; nil when the console is missing |
| `getMainWindowSize()` | ✅ | Returns `window.innerWidth, window.innerHeight` |
| `getUserWindowSize(name)` | ✅ | Bridge.lua → `__getUserWindowSize` |
| `getMainConsoleWidth()` | ✅ | Pixel width of the main console: monospace cell width × (wrap columns + 1) |
| `setWindowWrap(name, col)` | ✅ | JS-exposed |
| `windowType(name)` | ✅ | Bridge.lua → `__windowType` |
| `disableScrollBar(name)` | 🚧 | |
| `enableScrollBar(name)` | 🚧 | |
| `hasFocus([window])` | ✅ | JS-exposed; `document.activeElement` check. No name = command bar; a name targets the registered overlay element |
| `saveWindowLayout()` | ✅ | JS-exposed; snapshots window hints + dock extents into `connectionLayoutSnapshots` in the app store |
| `loadWindowLayout()` | ✅ | JS-exposed; re-applies the saved snapshot — re-positions live windows and reopens saved-visible windows that are currently closed |

---

## Labels

| Function | Status | Notes |
|---|---|---|
| `setLabelClickCallback(name, fn)` | ✅ | Bridge.lua + JS callback registry (`__mudix_setLabelClickCallback`) |
| `setLabelDoubleClickCallback(name, fn)` | ✅ | Bridge.lua |
| `setLabelReleaseCallback(name, fn)` | ✅ | Bridge.lua |
| `setLabelMoveCallback(name, fn)` | ✅ | Bridge.lua |
| `setLabelWheelCallback(name, fn)` | ✅ | Bridge.lua |
| `setLabelOnEnter(name, fn)` | ✅ | Bridge.lua |
| `setLabelOnLeave(name, fn)` | ✅ | Bridge.lua |
| `setLabelStyleSheet(name, css)` | ✅ | JS-exposed |
| `getLabelStyleSheet(name)` | ✅ | JS-exposed; reads the CSS last set via `setLabelStyleSheet` (`""` when none) |
| `getLabelFormat(name)` | ✅ | GUIUtils.lua; now resolves since `getLabelStyleSheet` is implemented |
| `getLabelSizeHint(name)` | 🚧 | Return preferred size |
| `setLabelCursor(name, shape)` | ✅ | JS-exposed |
| `setLabelCustomCursor(name, path[, hotX, hotY])` | ✅ | JS-exposed; CSS `cursor: url(...) hotX hotY, auto`. Path resolved through the VFS-aware rewriter |
| `resetLabelCursor(name)` | ✅ | JS-exposed |
| `setLabelToolTip(name, text, delay)` | ✅ | JS-exposed |
| `resetLabelToolTip(name)` | ✅ | JS-exposed |
| `setBackgroundImage(name, path)` | ✅ | Pure Lua via GUIUtils.lua → `setLabelStyleSheet` |
| `resetBackgroundImage(name)` | 🚧 | |

---

## Gauges

| Function | Status | Notes |
|---|---|---|
| `setGauge(name, current, max [, text])` | ✅ | Pure Lua via GUIUtils.lua (resizeWindow + moveWindow) |
| `moveGauge(name, x, y)` | ✅ | Pure Lua via GUIUtils.lua |
| `showGauge(name)` | ✅ | Pure Lua via GUIUtils.lua |
| `hideGauge(name)` | ✅ | Pure Lua via GUIUtils.lua |
| `setGaugeText(name, text [, r, g, b])` | ✅ | Pure Lua via GUIUtils.lua (`echo` + RGB2Hex) |
| `setGaugeStyleSheet(name, css [, textcss])` | ✅ | Pure Lua via GUIUtils.lua → `setLabelStyleSheet` |

---

## Command Line Widgets

| Function | Status | Notes |
|---|---|---|
| `clearCmdLine(name)` | ⚠️ | JS-exposed for main bar; named overlay widgets 🚧 |
| `getCmdLine(name)` | 🚧 | Read overlay command input |
| `appendCmdLine(name, text)` | ⚠️ | Main bar only; named widgets 🚧 |
| `printCmdLine(name, text)` | ⚠️ | JS-exposed for main bar; named widgets 🚧 |
| `setCmdLineAction(name, fn)` | ⚠️ | Bridge.lua wraps it for the main bar; named widgets 🚧 |
| `resetCmdLineAction(name)` | ⚠️ | Bridge.lua wraps it for the main bar; named widgets 🚧 |
| `selectCmdLineText([name])` | ⚠️ | JS-exposed; selects all main command-bar text (emits `script.selectcmd` → ProfileSession `.select()`). Named overlay widgets not yet wired |
| `enableCommandLine(name)` | 🚧 | |
| `disableCommandLine(name)` | 🚧 | |
| `setCmdLineStyleSheet(name, css)` | 🚧 | CSS on overlay input |
| `addCmdLineSuggestion(name, text)` | 🚧 | Add autocomplete suggestion |
| `removeCmdLineSuggestion(name, text)` | 🚧 | |
| `clearCmdLineSuggestions(name)` | 🚧 | |

---

## Fonts & Appearance (Overlay Elements)

| Function | Status | Notes |
|---|---|---|
| `setFont([window,] font)` | ✅ | Bridge.lua → `__setFont` |
| `getFont([window])` | ✅ | Bridge.lua → `__getFont` |
| `setFontSize([window,] size)` | ✅ | Bridge.lua → `__setFontSize` |
| `getFontSize([window])` | ✅ | Bridge.lua → `__getFontSize` |
| `calcFontSize(size[, family]) \| calcFontSize(windowName)` | ✅ | Bridge.lua → `__calcFontSize`; canvas-2D measurement of a monospace cell, falls back to the App.css `--font-mono` stack when no family is set |
| `getAvailableFonts()` | ✅ | JS-exposed; set-style `{[family]=true}` merging web-safe families, FontFaceSet registrations, the profile font, and Local Font Access results |
| `setMiniConsoleFontSize(name, size)` | ✅ | Bridge.lua → `__setMiniConsoleFontSize`; reuses `WindowManager.setFontSize` but rejects non-miniconsole targets to match Mudlet's CONSOLE-only check |
| `setAppStyleSheet(css)` | ✅ | JS-exposed — installs/replaces a CSS block in `document.head`, raises `sysAppStyleSheetChange` |
| `setUserWindowStyleSheet(name, css)` | ✅ | JS-exposed |
| `getBorderTop()` | ✅ | JS-exposed |
| `getBorderBottom()` | ✅ | JS-exposed |
| `getBorderLeft()` | ✅ | JS-exposed |
| `getBorderRight()` | ✅ | JS-exposed |
| `getBorderSizes()` | ✅ | JS-exposed |
| `setBorderTop(px)` | ✅ | JS-exposed |
| `setBorderBottom(px)` | ✅ | JS-exposed |
| `setBorderLeft(px)` | ✅ | JS-exposed |
| `setBorderRight(px)` | ✅ | JS-exposed |
| `setBorderColor(r,g,b)` | ✅ | JS-exposed (also `resetBorderColor`) |

---

## Toolbars / Buttons

| Function | Status | Notes |
|---|---|---|
| `showToolBar(name)` | 🚧 | Show/hide a named toolbar in the app chrome |
| `hideToolBar(name)` | 🚧 | |
| `tempButton(toolbar, name, code, orientation)` | 🚧 | Add a button to a toolbar |
| `tempButtonToolbar(name, orientation, float)` | 🚧 | Create a toolbar |
| `setButtonState(name, state)` | 🚧 | Check/uncheck a toggle button |
| `getButtonState(name)` | 🚧 | |
| `setButtonStyleSheet(name, css)` | 🚧 | CSS on button element |

---

## Mapper

> Mudix loads Mudlet binary `.dat` map files for display. The programmatic mapper API is a long-term goal.

| Function | Status | Notes |
|---|---|---|
| `centerview(roomID)` | ✅ | JS-exposed; sets the player room as a side effect (matches Mudlet) |
| `getPlayerRoom()` | ✅ | Returns the id last passed to `centerview`; `nil` when unset or the room was deleted |
| `getPath(fromID, toID)` | 🚧 | Pathfinding; populates `speedWalkDir`/`speedWalkPath` |
| `speedwalk(roomID [, walkcmd, delay])` | ✅ | Pure Lua via Other.lua (uses `send` + `tempTimer`) |
| `pauseSpeedwalk()` | ✅ | Pure Lua via Other.lua |
| `resumeSpeedwalk()` | ✅ | Pure Lua via Other.lua |
| `stopSpeedwalk()` | ✅ | Pure Lua via Other.lua |
| `getRoomName(roomID)` | ✅ | Bridge.lua → `__getRoomName` |
| `getRoomCoordinates(roomID)` | ✅ | Bridge.lua → `__getRoomCoordinates` |
| `getRoomExits(roomID)` | ✅ | JS-exposed |
| `getRoomArea(roomID)` | ✅ | JS-exposed |
| `getRoomEnv(roomID)` | ✅ | JS-exposed |
| `getRooms()` | ✅ | JS-exposed |
| `getAreaTable()` | ✅ | JS-exposed |
| `getAreaRooms(areaID)` | ✅ | JS-exposed |
| `highlightRoom(roomID, ...)` | 🚧 | Color highlight on map |
| `unHighlightRoom(roomID)` | 🚧 | |
| `roomExists(roomID)` | ✅ | JS-exposed |
| `addRoom(roomID)` | ✅ | JS-exposed |
| `deleteRoom(roomID)` | ✅ | JS-exposed |
| `setRoomName(roomID, name)` | ✅ | JS-exposed |
| `setRoomCoordinates(roomID, x, y, z)` | ✅ | JS-exposed |
| `setRoomArea(roomID, areaID)` | ✅ | JS-exposed |
| `setExit(fromID, toID, dir)` | ✅ | JS-exposed |
| `addSpecialExit(fromID, toID, cmd)` | ✅ | JS-exposed |
| `removeSpecialExit(fromID, cmd)` | ✅ | JS-exposed |
| `getSpecialExits(roomID [, listAllExits])` | ✅ | Bridge.lua re-keys `__getSpecialExits` → `{[exitRoomID]={[cmd]="0"\|"1"}}`; lowest-weight command per room unless `listAllExits` |
| `getSpecialExitsSwap(roomID)` | ✅ | JS-exposed; `{cmd=toId}` |
| `getExitStubs(roomID)` | ✅ | JS-exposed; returns a 0-indexed table of stub direction numbers (wasmoon array convention, matches Mudlet) |
| `getExitStubs1(roomID)` | ✅ | Bridge.lua wraps `getExitStubs` and re-indexes to a 1-based table |
| `getCustomLines(roomID)` | ✅ | JS-exposed; `{ dir = { attributes={color,style,arrow}, points={[0]={x,y,z},...} } }`. Returns nil for missing rooms, empty table when none |
| `lockRoom(roomID, bool)` | ✅ | JS-exposed; sets `room.isLocked` (honoured by pathfinding) |
| `roomLocked(roomID)` | ✅ | JS-exposed; lock state, or nil when the room is missing |
| `lockExit(roomID, dir, bool)` | ⚠️ | Pure-Lua wrapper in Other.lua stores into room user-data; not honoured by pathfinding (no `getPath` yet) |
| `setRoomWeight(roomID, weight)` | ✅ | JS-exposed; rejects negative weights |
| `getRoomWeight(roomID)` | ✅ | JS-exposed; false when the room is missing |
| `getExitWeights(roomID)` | ✅ | JS-exposed; `{exit=weight}` keyed by short direction name or special-exit command |
| `setExitWeight(roomID, exitCommand, weight)` | ✅ | JS-exposed; weight 0 resets to destination-room weight; rejects negatives/unknown exits |
| `getRoomUserData(roomID, key)` | ✅ | Bridge.lua → `__getRoomUserData` |
| `setRoomUserData(roomID, key, value)` | ✅ | JS-exposed |
| `getRoomUserDataKeys(roomID)` | ✅ | Bridge.lua → `__getRoomUserDataKeys`; re-indexes JS 0-based array to 1-based Lua table; `nil` when room missing |
| `getMapLabels(areaID)` | ✅ | Bridge.lua → `__getMapLabels`; re-keys numeric-string keys back to integer label ids |
| `getMapLabel(areaID, labelID\|labelText)` | ✅ | Bridge.lua → `__getMapLabel`; by-id returns flat properties, by-text returns `{[id]=properties}` matches |
| `loadMap(path)` | ✅ | JS-exposed |
| `saveMap(path)` | ✅ | JS-exposed; serialises MapStore via `writeMapToBuffer` and writes to VFS / IDB |
| `saveJsonMap(path)` / `loadJsonMap(path)` | 🚧 | JSON map format |
| `updateMap()` | 🚧 | Force redraw |
| `getMapZoom()` / `setMapZoom(level)` | 🚧 | |
| All other mapper functions | 🚧 | ~90 total — implement incrementally |

---

## String Utilities

| Function | Status | Notes |
|---|---|---|
| `string.starts(s, prefix)` | ✅ | |
| `string.ends(s, suffix)` | ✅ | |
| `string.trim(s)` | ✅ | |
| `string.split(s, sep)` | ✅ | |
| `string.contains(s, sub)` | ✅ | |
| `string.title(s)` | ✅ | StringUtils.lua |
| `string.cut(s, maxlen)` | ✅ | StringUtils.lua |
| `string.patternEscape(s)` | ✅ | StringUtils.lua |
| `string.genNocasePattern(s)` | ✅ | StringUtils.lua |
| `f(str)` | ✅ | StringUtils.lua — string interpolation: `{expr}` inside strings |

---

## Table Utilities

| Function | Status | Notes |
|---|---|---|
| `table.contains(t, val)` | ✅ | |
| `table.size(t)` | ✅ | Count all keys including non-integer |
| `table.deepcopy(t)` | ✅ | TableUtils.lua |
| `table.keys(t)` | ✅ | TableUtils.lua |
| `table.index_of(t, val)` | ✅ | TableUtils.lua |
| `table.union(t1, t2, ...)` | ✅ | TableUtils.lua |
| `table.complement(t1, t2)` | ✅ | TableUtils.lua |
| `table.intersection(t1, t2)` | ✅ | TableUtils.lua |
| `table.is_empty(t)` | ✅ | TableUtils.lua |
| `table.update(t1, t2)` | ✅ | TableUtils.lua |
| `table.collect(t, fn)` | ✅ | TableUtils.lua |
| `table.n_flatten(t)` | ✅ | TableUtils.lua |
| `table.save(filename, t)` | ✅ | Other.lua, uses `io.open`/VFS (works once VFS is mounted) |
| `table.load(filename)` | ✅ | Other.lua, uses `dofile`/VFS |
| `spairs(t [, fn])` | ✅ | TableUtils.lua — sorted-key iterator |
| `printTable(t)` | ✅ | TableUtils.lua |

---

## Date / Time

| Function | Status | Notes |
|---|---|---|
| `getTime([returnAsTable, format])` | ✅ | Bridge.lua — full Qt QDateTime token formatting |
| `getEpoch()` | ✅ | JS-exposed (`Date.now() / 1000`) |
| `getTimestamp([linenum])` | 🚧 | Timestamp stored per output line |

---

## Virtual Filesystem

| Function | Status | Notes |
|---|---|---|
| `io.exists(path)` | ✅ | Other.lua (uses `io.open`) backed by ProfileVFS |
| `io.open(path, mode)` | ✅ | LuaRuntime VFS bridge (`__vfs_io_open__` etc.) |
| `addFileWatch(path)` | 🚧 | Watch VFS path for changes |
| `removeFileWatch(path)` | 🚧 | |
| `getMudletHomeDir()` | ✅ | VFS.lua — alias for `getMudixProfilePath()` |
| `invokeFileDialog(type, title)` | 🚧 | Native `<input type="file">` picker |
| `table.save(filename, t)` | ✅ | See Table Utilities |
| `table.load(filename)` | ✅ | See Table Utilities |

---

## Profile / Session

| Function | Status | Notes |
|---|---|---|
| `getProfileName()` | ✅ | JS-exposed |
| `getNetworkLatency()` | ✅ | JS-exposed |
| `getOS()` | ✅ | Sniffs the underlying OS from the user agent → `"windows"`/`"mac"`/`"linux"`/`"freebsd"`/`"openbsd"`/`"netbsd"`/`"unknown"` |
| `getWindowsCodepage()` | ✅ | Returns `"65001"` (UTF-8) on every platform — the browser VFS is always UTF-8, so the bundled `utf8_filenames.lua` skips legacy-ANSI transcoding |
| `getMudletVersion()` | ✅ | Bridge.lua — supports `nil`/`"string"`/`"major"`/`"minor"`/`"revision"`/`"build"`/`"table"` modes |
| `debug(text)` | ⚠️ | `debugc` is JS-exposed (`console.log`); Mudlet name `debug` not aliased |
| `remember(varname)` | ✅ | Other.lua (persists into `SavedVariables.lua` via VFS) |
| `saveVars()` / `loadVars()` | ✅ | Other.lua |
| `shms(seconds)` | ✅ | DateTime.lua |
| `xor(a, b)` | ✅ | Other.lua |
| `compare(a, b)` | ✅ | Other.lua — alias for `_comp` deep equality |
| `f(str)` | ✅ | StringUtils.lua (see String section) |
| `openUrl(url)` | ✅ | JS-exposed — `window.open(url, '_blank')`; a `file:` prefix routes to the VFS file browser (matches Mudlet's `openMudletHomeDir`) |
| `showNotification(title, text)` | ✅ | Web Notifications API; gated on the Settings opt-in (`client.notificationsEnabled`) which is where the permission prompt is raised. Optional expiry auto-closes |
| `alert([secs])` | ✅ | JS-exposed; flashes `document.title` for `secs` (default 10). No-op while the tab is focused (matches Mudlet) |
| `loadReplay(path)` | 🚧 | Replay a recorded session from VFS |
| `startLogging(bool)` | 🚧 | Log session output to VFS file |
| `loadProfile(name)` | ❌ | No multi-profile switching |
| `saveProfile([name])` | ❌ | Auto-persists via localStorage |
| `closeMudlet()` | ❌ | |
| `getProfiles()` | ❌ | |

---

## Sound / Media

| Function | Status | Notes |
|---|---|---|
| `playSoundFile(path [, vol, loops, ch])` | ✅ | Bridge.lua → `SoundManager` (Web Audio + VFS or http(s) URL) |
| `loadSoundFile(path)` | ✅ | Bridge.lua → `SoundManager.preload`; decodes + caches so the first `playSoundFile` has no latency. Accepts positional or table form |
| `pauseSounds([channel])` | 🚧 | |
| `stopSounds([channel])` | ✅ | JS-exposed |
| `getPlayingSounds()` | ✅ | Bridge.lua → `SoundManager.getPlaying`; re-indexes to a 1-based array of `{name, key, tag, volume}`. Optional name/key/tag filter |
| `playMusicFile(path [, vol, loops, ch])` | ✅ | Bridge.lua → `SoundManager` |
| `stopMusic([channel])` | ✅ | Bridge.lua → `SoundManager` |
| `playVideoFile(path)` | 🚧 | HTML `<video>` element in overlay |
| `pauseVideos()` | 🚧 | |
| `stopVideos()` | 🚧 | |

---

## Text-to-Speech

| Function | Status | Notes |
|---|---|---|
| `ttsSpeak(text)` | ✅ | Web Speech API (`TtsManager`); speaks immediately, interrupting current. Strips angle brackets like Mudlet |
| `ttsQueue(text [, index])` | ✅ | Inserts at 1-based `index` (default end); raises `ttsSpeechQueued(text, index)` |
| `ttsClearQueue([index])` | ✅ | Clears whole queue or the 1-based `index` item (false if out of bounds) |
| `ttsGetQueue([index])` | ✅ | Bridge.lua re-indexes to a 1-based table; `index` form returns one item or false |
| `ttsPause()` | ✅ | |
| `ttsResume()` | ✅ | |
| `ttsSkip()` | ✅ | Stops current, advances to next queued |
| `ttsGetVoices()` | ✅ | Bridge.lua re-indexes `speechSynthesis.getVoices()` names to a 1-based table |
| `ttsGetCurrentVoice()` | ✅ | Selected voice name, or engine default |
| `ttsGetCurrentLine()` | ✅ | Bridge.lua maps idle/errored to `(nil, "not speaking any text")` |
| `ttsSetVoiceByName(name)` | ✅ | Returns bool; raises `ttsVoiceChanged` |
| `ttsSetVoiceByIndex(index)` | ✅ | 1-based index into `ttsGetVoices()`; returns bool |
| `ttsSetRate(rate)` / `ttsGetRate()` | ✅ | Mudlet range -1..1 (0 = normal); raises `ttsRateChanged`. Mapped to Web Speech range at speak time |
| `ttsSetPitch(pitch)` / `ttsGetPitch()` | ✅ | Mudlet range -1..1; raises `ttsPitchChanged` |
| `ttsSetVolume(vol)` / `ttsGetVolume()` | ✅ | Mudlet range 0..1; raises `ttsVolumeChanged` |
| `ttsGetState()` | ✅ | `ttsSpeechReady`/`ttsSpeechStarted`/`ttsSpeechPaused`/`ttsSpeechError`/`ttsUnknownState`, raised as events on transitions |

---

## Geyser OOP Framework

> Implementable in pure Lua once the overlay primitive API (`createLabel`, `createMiniConsole`, `createGauge`, `createCommandLine`, `moveWindow`, `resizeWindow`) exists. No additional JS required.

| Class | Status | Notes |
|---|---|---|
| `Geyser.Container` | ✅ | Bundled Lua file is loaded; pure layout, no missing deps |
| `Geyser.Label` | ⚠️ | Bundled and mostly working; `getLabelFormat` is partial because `getLabelStyleSheet` is missing |
| `Geyser.MiniConsole` | ✅ | Bundled; constructor calls `setMiniConsoleFontSize` (now ✅) |
| `Geyser.Gauge` | ✅ | Bundled; wraps GUIUtils `createGauge`/`setGauge` (both ✅) |
| `Geyser.HBox` | ✅ | Bundled |
| `Geyser.VBox` | ✅ | Bundled |
| `Geyser.CommandLine` | ⚠️ | Bundled but `createCommandLine` is missing |
| `Geyser.UserWindow` | ✅ | Bundled; uses `openUserWindow` ✅ |
| `Geyser.ReflowContainer` | 🚧 | Not bundled in `LuaGlobal.lua` load list |

---

## Not Applicable

| Feature | Reason |
|---|---|
| Discord Rich Presence | Requires Discord SDK |
| IRC client | Separate external service |
| Multi-profile management (`loadProfile`, `getProfiles`) | Single-connection web app |
| `setAppStyleSheet(css)` | Qt application-wide CSS |
| `spawn()` subprocess | No subprocess in browser |
| `sendATCP(msg)` | Legacy protocol |
| Module/package installation (`installModule`, etc.) | No package ecosystem |
| `raiseGlobalEvent` | Multi-profile only |

---

## Implementation Priority

### Tier 1 — Core scripting primitives (pure Lua or trivial JS)
1. `table.deepcopy`, `table.keys`, `table.index_of`, `table.is_empty`, `table.update`
2. `string.patternEscape`, `string.title`, `string.cut`, `f(str)` interpolation
3. `getTime()`, `getEpoch()` — timestamps
4. `shms(seconds)`, `xor`, `compare` — pure Lua utils
5. Color converters (`cecho2string`, `ansi2string`, `cecho2decho`, etc.) — pure Lua
6. `killAnonymousEventHandler(id)` — needs ID tracking in `registerAnonymousEventHandler`
7. Stopwatch API (`createStopWatch`, `startStopWatch`, `stopStopWatch`, `getStopWatchTime`)
8. `closestColor(r, g, b)`

### Tier 2 — Scripting power features
9. `sendGMCP(message)` — outbound GMCP
10. `expandAlias(text)` — alias expansion from Lua
11. `getCmdLine()` / `clearCmdLine()` — command bar read/clear
12. Enable/disable permanent aliases, triggers, timers, keys by name
13. `getHTTP()` / `postHTTP()` — fetch-backed HTTP
14. `getCurrentLine()`, `getLineCount()`, `getLines()` — output buffer read
15. `selectString()`, `replace()`, `replaceLine()` — output text rewriting
16. `getConnectionInfo()`, `getNetworkLatency()`, `getProfileName()`

### Tier 3 — Overlay UI system (requires new subsystem)
17. Overlay manager: `createMiniConsole`, `createLabel`, `createGauge`, `createCommandLine`
18. `moveWindow`, `resizeWindow`, `showWindow`, `hideWindow`, `raiseWindow`, `lowerWindow`
19. Label event callbacks, `setLabelStyleSheet`, `setBackgroundImage`
20. Gauge API (`setGauge`, `setGaugeText`, `setGaugeStyleSheet`)
21. Overlay command line API
22. Geyser framework (pure Lua once overlay primitives exist)

### Tier 4 — Virtual filesystem
23. IndexedDB VFS with `io.open`, `io.exists`, `getMudletHomeDir`
24. `table.save` / `table.load`
25. `downloadFile`, `saveMap`/`loadMap`
26. `saveVars` / `loadVars` / `remember`
27. `startLogging`

### Tier 5 — Nice to have
28. `echoLink()`, `echoPopup()` — clickable output
29. Sound API (Web Audio + VFS)
30. TTS API (Web Speech)
31. Mapper read/write API
32. `permAlias` / `permTrigger` / `permTimer` / `permKey` from Lua
