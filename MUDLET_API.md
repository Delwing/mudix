# Mudlet API Implementation Checklist

Status legend:
- ✅ Implemented
- 🚧 Feasible — worth implementing
- ⚠️ Partial — skeleton exists, needs more work
- ❌ N/A — fundamentally inapplicable (multi-profile, subprocess, Discord SDK, IRC, etc.)

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
| `cfeedTriggers(text)` | 🚧 | cecho-formatted feedTriggers |
| `dfeedTriggers(text)` | 🚧 | decho-formatted feedTriggers |
| `hfeedTriggers(text)` | 🚧 | hecho-formatted feedTriggers |
| `deleteLine()` | ✅ | Removes last output element |
| `prefix(text)` | 🚧 | Prepend text to current trigger line |
| `suffix(text)` | 🚧 | Append text to current trigger line |
| `replace(text)` | 🚧 | Replace selected text |
| `replaceLine(text)` | 🚧 | Replace entire current line |
| `creplace(text)` | 🚧 | replace() with cecho format |
| `dreplace(text)` | 🚧 | replace() with decho format |
| `hreplace(text)` | 🚧 | replace() with hecho format |
| `insertText([window,] text)` | 🚧 | Insert at cursor position |
| `cinsertText([window,] text)` | 🚧 | insertText() with cecho format |
| `wrapLine([window,] linenum)` | 🚧 | Re-wrap a line |
| `scrollUp([window,] lines)` | 🚧 | Scroll output up |
| `scrollDown([window,] lines)` | 🚧 | Scroll output down |
| `showColors([columns])` | 🚧 | Print all named colors |
| `showCaptureGroups()` | 🚧 | Print current trigger match captures |
| `announce(text)` | 🚧 | `aria-live` region or Web Speech API |

---

## Text Selection & Cursor

| Function | Status | Notes |
|---|---|---|
| `selectString([window,] text, n)` | 🚧 | Select Nth occurrence in current line |
| `selectSection([window,] col, len)` | 🚧 | Select by column + length |
| `selectCaptureGroup(n)` | 🚧 | Select Nth regex capture from last match |
| `selectCurrentLine([window])` | 🚧 | Select entire current line |
| `deselect([window])` | 🚧 | Clear selection |
| `getSelection([window])` | 🚧 | Return selected text |
| `moveCursor([window,] x, y)` | 🚧 | Move cursor to position |
| `moveCursorEnd([window])` | 🚧 | Move cursor to end of buffer |
| `getLineNumber([window])` | 🚧 | Current absolute line number |
| `getColumnNumber([window])` | 🚧 | Current column |
| `getLineCount([window])` | 🚧 | Total lines in console buffer |
| `getLastLineNumber([window])` | 🚧 | Number of last line |
| `getCurrentLine([window])` | 🚧 | Content of current trigger line (`line` global already set) |
| `getLines([window,] from, to)` | 🚧 | Return table of lines between two indices |
| `getRowCount([window])` | 🚧 | Number of visible rows |
| `getColumnCount([window])` | 🚧 | Number of visible columns |

---

## Text Formatting & Color

| Function | Status | Notes |
|---|---|---|
| `fg([window,] colorname)` | ✅ | Set foreground color by name |
| `bg([window,] colorname)` | ✅ | Set background color by name |
| `resetFormat([window])` | ✅ | Reset all formatting |
| `setFgColor([window,] r, g, b)` | 🚧 | Set foreground by RGB |
| `setBgColor([window,] r, g, b)` | 🚧 | Set background by RGB |
| `setHexFgColor([window,] hex)` | 🚧 | Set foreground by hex string |
| `setHexBgColor([window,] hex)` | 🚧 | Set background by hex string |
| `setBold([window,] bool)` | 🚧 | Toggle bold |
| `setItalics([window,] bool)` | 🚧 | Toggle italics |
| `setUnderline([window,] bool)` | 🚧 | Toggle underline |
| `setStrikeOut([window,] bool)` | 🚧 | Toggle strikethrough |
| `setReverse([window,] bool)` | 🚧 | Toggle reverse video |
| `setTextFormat([window,] ...)` | 🚧 | Set all formatting in one call |
| `getTextFormat([window])` | 🚧 | Get current formatting |
| `setCommandBackgroundColor(r,g,b,a)` | 🚧 | CSS on main command bar |
| `setCommandForegroundColor(r,g,b,a)` | 🚧 | CSS on main command bar |
| `setBackgroundColor([window,] r,g,b,a)` | 🚧 | Set window/overlay background color |

---

## Color Conversion Utilities

All of these are pure text-transformation functions implementable in Lua/JS with no platform dependencies.

| Function | Status | Notes |
|---|---|---|
| `cecho2ansi(text)` | 🚧 | cecho → ANSI escape codes |
| `cecho2decho(text)` | 🚧 | cecho → decho |
| `cecho2hecho(text)` | 🚧 | cecho → hecho |
| `cecho2string(text)` | 🚧 | Strip cecho tags, return plain text |
| `cecho2html(text)` | 🚧 | cecho → HTML spans |
| `decho2ansi(text)` | 🚧 | decho → ANSI |
| `decho2cecho(text)` | 🚧 | decho → cecho |
| `decho2hecho(text)` | 🚧 | decho → hecho |
| `decho2string(text)` | 🚧 | Strip decho, return plain text |
| `decho2html(text)` | 🚧 | decho → HTML |
| `hecho2ansi(text)` | 🚧 | hecho → ANSI |
| `hecho2cecho(text)` | 🚧 | hecho → cecho |
| `hecho2decho(text)` | 🚧 | hecho → decho |
| `hecho2string(text)` | 🚧 | Strip hecho, return plain text |
| `hecho2html(text)` | 🚧 | hecho → HTML |
| `ansi2decho(text)` | 🚧 | ANSI → decho |
| `ansi2string(text)` | 🚧 | Strip ANSI, return plain text |
| `closestColor(r, g, b)` | 🚧 | Find nearest named color in color_table |
| `getFgColor([window])` | 🚧 | Get foreground RGB of selection |
| `getBgColor([window])` | 🚧 | Get background RGB of selection |
| `color_table` | ✅ | Named color → {r,g,b} table |

---

## Clickable Links & Popups

| Function | Status | Notes |
|---|---|---|
| `echoLink([window,] text, cmd, hint)` | 🚧 | `<a>` element running a send() on click |
| `cechoLink([window,] text, cmd, hint)` | 🚧 | cecho-formatted link |
| `dechoLink([window,] text, cmd, hint)` | 🚧 | decho-formatted link |
| `hechoLink([window,] text, cmd, hint)` | 🚧 | hecho-formatted link |
| `insertLink([window,] text, cmd, hint)` | 🚧 | Insert link at cursor |
| `echoPopup([window,] text, cmds, hints)` | 🚧 | Right-click context menu via HTML/CSS |
| `cechoPopup(...)` | 🚧 | cecho-formatted popup |
| `dechoPopup(...)` | 🚧 | decho-formatted popup |
| `hechoPopup(...)` | 🚧 | hecho-formatted popup |
| `insertPopup([window,] text, cmds, hints)` | 🚧 | Insert popup at cursor |
| `setLink([window,] cmd, hint)` | 🚧 | Make selection a link |
| `setPopup([window,] cmds, hints)` | 🚧 | Make selection a popup |

---

## Command Input

| Function | Status | Notes |
|---|---|---|
| `send(text [, echo])` | ✅ | Send command to MUD |
| `sendAll(text1, text2, ...)` | ✅ | Send multiple commands at once |
| `expandAlias(text [, echo])` | 🚧 | Run text through alias engine without sending |
| `denyCurrentSend()` | 🚧 | Cancel current outgoing command |
| `appendCmdLine(text)` | ✅ | Append text to main command bar |
| `setCmdLine(text)` | ✅ | Set main command bar text |
| `getCmdLine([name])` | 🚧 | Read current command bar text |
| `clearCmdLine([name])` | 🚧 | Clear command bar |
| `feedTelnet(data)` | 🚧 | Feed raw telnet bytes into pipeline |

---

## Aliases

| Function | Status | Notes |
|---|---|---|
| `tempAlias(pattern, code)` | ✅ | Temporary Lua regex alias |
| `killAlias(id)` | ✅ | Delete temp alias by ID |
| `permAlias(name, parent, pattern, code)` | ⚠️ | Permanent aliases exist in store; no Lua creation API yet |
| `enableAlias(name)` | 🚧 | Enable permanent alias by name |
| `disableAlias(name)` | 🚧 | Disable permanent alias by name |
| `exists(name, type)` | 🚧 | Check if item with given name exists |
| `isActive(name, type)` | 🚧 | Check if item is currently enabled |

---

## Triggers

| Function | Status | Notes |
|---|---|---|
| `tempTrigger(pattern, code)` | ✅ | Temporary substring/regex trigger |
| `killTrigger(id)` | ✅ | Delete temp trigger by ID |
| `tempRegexTrigger(pattern, code)` | 🚧 | Explicit regex variant |
| `tempBeginOfLineTrigger(pattern, code)` | 🚧 | Anchored `^` trigger |
| `tempExactMatchTrigger(pattern, code)` | 🚧 | Full-line exact match |
| `tempColorTrigger(fg, bg, code)` | 🚧 | Match on ANSI color in line |
| `tempLineTrigger(from, count, code)` | 🚧 | Fire on N consecutive lines |
| `tempPromptTrigger(code)` | 🚧 | Fire on MUD prompt detection |
| `permRegexTrigger(name, parent, pattern, code)` | ⚠️ | Permanent triggers exist; no Lua creation API yet |
| `permSubstringTrigger(name, parent, pattern, code)` | ⚠️ | Same |
| `enableTrigger(name)` | 🚧 | Enable permanent trigger by name |
| `disableTrigger(name)` | 🚧 | Disable permanent trigger by name |
| `killTrigger(name)` | 🚧 | Delete named permanent trigger |
| `setTriggerStayOpen(name, lines)` | 🚧 | Keep trigger active for N extra lines |

---

## Timers

| Function | Status | Notes |
|---|---|---|
| `tempTimer(delay, code [, repeat])` | ✅ | One-shot or repeating timer |
| `killTimer(id)` | ✅ | Delete timer by ID |
| `permTimer(name, parent, delay, code)` | ⚠️ | Permanent timers exist; no Lua creation API yet |
| `enableTimer(name)` | 🚧 | Enable permanent timer by name |
| `disableTimer(name)` | 🚧 | Disable permanent timer by name |
| `remainingTime(id)` | 🚧 | Seconds left on a timer |

---

## Keybindings

| Function | Status | Notes |
|---|---|---|
| `tempKey(modifier, key, code)` | ✅ | Temporary keybinding |
| `killKey(id)` | ✅ | Delete keybinding by ID |
| `permKey(name, parent, modifier, key, code)` | ⚠️ | Permanent keybindings exist; no Lua creation API yet |
| `enableKey(name)` | 🚧 | Enable permanent keybinding by name |
| `disableKey(name)` | 🚧 | Disable permanent keybinding by name |

---

## Stopwatches

| Function | Status | Notes |
|---|---|---|
| `createStopWatch([name])` | 🚧 | `performance.now()`-based high-res stopwatch |
| `startStopWatch(id)` | 🚧 | |
| `stopStopWatch(id)` | 🚧 | Returns elapsed seconds |
| `resetStopWatch(id)` | 🚧 | |
| `getStopWatchTime(id)` | 🚧 | Elapsed ms without stopping |
| `adjustStopWatch(id, seconds)` | 🚧 | |
| `deleteStopWatch(id)` | 🚧 | |
| `getStopWatches()` | 🚧 | Table of all stopwatches |

---

## Events

| Function | Status | Notes |
|---|---|---|
| `raiseEvent(name, ...)` | ✅ | Fire custom Lua event |
| `registerAnonymousEventHandler(name, fn)` | ✅ | Register handler; ID return not yet tracked |
| `killAnonymousEventHandler(id)` | 🚧 | Needs ID tracking in registerAnonymousEventHandler |
| `mudix.on(event, fn)` | ✅ | Mudix-native registration |
| `mudix.off(event, fn)` | ✅ | Mudix-native deregistration |
| `registerNamedEventHandler(name, event, code)` | 🚧 | Named manageable handler |
| `deleteNamedEventHandler(name)` | 🚧 | |
| `stopNamedEventHandler(name)` | 🚧 | |
| `resumeNamedEventHandler(name)` | 🚧 | |
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
| `sendGMCP(message)` | 🚧 | Send outbound GMCP message |
| `sendMSDP(var, ...)` | 🚧 | MSDP variable request |
| `sendSocket(data)` | 🚧 | Send raw bytes over socket |
| `getConnectionInfo()` | 🚧 | Return host/port/ssl |
| `getNetworkLatency()` | 🚧 | Last ping duration (`ping` event already exists) |
| `connectToServer(host, port)` | 🚧 | Connect from Lua |
| `disconnect()` | ✅ | Via session |
| `addSupportedTelnetOption(option)` | 🚧 | Advertise a custom telnet option via the WebSocket proxy |
| `sendATCP(msg)` | ❌ | Legacy protocol, no plans |

---

## HTTP Requests

| Function | Status | Notes |
|---|---|---|
| `getHTTP(url [, headers])` | 🚧 | `fetch` GET; fires `sysGetHttpDone` event |
| `postHTTP(url, data [, headers])` | 🚧 | `fetch` POST |
| `putHTTP(url, data [, headers])` | 🚧 | `fetch` PUT |
| `deleteHTTP(url [, headers])` | 🚧 | `fetch` DELETE |
| `downloadFile(url, path)` | 🚧 | `fetch` + write to virtual filesystem |

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
| `showWindow(name)` | 🚧 | Show panel or overlay element |
| `hideWindow(name)` | 🚧 | Hide panel or overlay element |
| `raiseWindow(name)` | 🚧 | Bring overlay to front (CSS `z-index`) |
| `lowerWindow(name)` | 🚧 | Send overlay to back |
| `moveWindow(name, x, y)` | 🚧 | Move overlay element (CSS `left`/`top`) — dockview panels not affected |
| `resizeWindow(name, w, h)` | 🚧 | Resize overlay element (CSS `width`/`height`) — dockview panels not affected |
| `createMiniConsole(name, x, y, w, h)` | 🚧 | Absolutely-positioned scrollable text console |
| `createLabel(name, x, y, w, h, passthrough)` | 🚧 | Absolutely-positioned HTML/image overlay |
| `createGauge(name, x, y, w, h, parent)` | 🚧 | Absolutely-positioned progress-bar overlay |
| `createCommandLine(name, x, y, w, h)` | 🚧 | Absolutely-positioned extra input widget |
| `createBuffer(name)` | 🚧 | Off-screen text buffer (no position) |
| `appendBuffer(name)` | 🚧 | Paste buffer content into a window |
| `echoUserWindow(name, text)` | ✅ | Alias for `mudix.windows.write` |
| `deleteMiniConsole(name)` | 🚧 | Remove overlay mini-console |
| `deleteLabel(name)` | 🚧 | Remove overlay label |
| `deleteCommandLine(name)` | 🚧 | Remove overlay command line |
| `setConsoleBufferSize(name, lines)` | 🚧 | Scrollback size limit |
| `getConsoleBufferSize([window])` | 🚧 | |
| `getMainWindowSize()` | 🚧 | `window.innerWidth` / `innerHeight` |
| `getUserWindowSize(name)` | 🚧 | `element.getBoundingClientRect()` |
| `getMainConsoleWidth()` | 🚧 | Character width of main console |
| `setWindowWrap(name, col)` | 🚧 | Word-wrap column |
| `windowType(name)` | 🚧 | Return element type string |
| `disableScrollBar(name)` | 🚧 | |
| `enableScrollBar(name)` | 🚧 | |
| `hasFocus([window])` | 🚧 | `document.activeElement` check |

---

## Labels

| Function | Status | Notes |
|---|---|---|
| `setLabelClickCallback(name, fn)` | 🚧 | `addEventListener('click', ...)` on overlay |
| `setLabelDoubleClickCallback(name, fn)` | 🚧 | `dblclick` |
| `setLabelReleaseCallback(name, fn)` | 🚧 | `mouseup` |
| `setLabelMoveCallback(name, fn)` | 🚧 | `mousemove` |
| `setLabelWheelCallback(name, fn)` | 🚧 | `wheel` |
| `setLabelOnEnter(name, fn)` | 🚧 | `mouseenter` |
| `setLabelOnLeave(name, fn)` | 🚧 | `mouseleave` |
| `setLabelStyleSheet(name, css)` | 🚧 | CSS string applied to the element |
| `getLabelStyleSheet(name)` | 🚧 | Read current CSS |
| `getLabelFormat(name)` | 🚧 | Return formatting table |
| `getLabelSizeHint(name)` | 🚧 | Return preferred size |
| `setLabelCursor(name, shape)` | 🚧 | CSS `cursor` property |
| `setLabelCustomCursor(name, path, x, y)` | 🚧 | CSS `cursor: url(...)` |
| `resetLabelCursor(name)` | 🚧 | |
| `setLabelToolTip(name, text, delay)` | 🚧 | HTML `title` attribute or tooltip overlay |
| `resetLabelToolTip(name)` | 🚧 | |
| `setBackgroundImage(name, path)` | 🚧 | CSS `background-image`; path from virtual FS |
| `resetBackgroundImage(name)` | 🚧 | |

---

## Gauges

| Function | Status | Notes |
|---|---|---|
| `setGauge(name, current, max [, text])` | 🚧 | Update gauge fill and label |
| `moveGauge(name, x, y)` | 🚧 | Alias for `moveWindow` |
| `showGauge(name)` | 🚧 | Alias for `showWindow` |
| `hideGauge(name)` | 🚧 | Alias for `hideWindow` |
| `setGaugeText(name, text [, r, g, b])` | 🚧 | Set text inside gauge |
| `setGaugeStyleSheet(name, css [, textcss])` | 🚧 | CSS on gauge element |

---

## Command Line Widgets

| Function | Status | Notes |
|---|---|---|
| `clearCmdLine(name)` | 🚧 | Clear overlay command input |
| `getCmdLine(name)` | 🚧 | Read overlay command input |
| `appendCmdLine(name, text)` | ✅ | Main bar only right now; named widgets 🚧 |
| `printCmdLine(name, text)` | 🚧 | Set text in overlay command input |
| `setCmdLineAction(name, fn)` | 🚧 | Callback when overlay input is submitted |
| `resetCmdLineAction(name)` | 🚧 | |
| `selectCmdLineText(name)` | 🚧 | Select all text in input |
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
| `setFont([window,] font)` | 🚧 | CSS `font-family` on overlay or window |
| `getFont([window])` | 🚧 | |
| `setFontSize([window,] size)` | 🚧 | CSS `font-size` |
| `getFontSize([window])` | 🚧 | |
| `getAvailableFonts()` | 🚧 | `document.fonts` API |
| `setMiniConsoleFontSize(name, size)` | 🚧 | Font size on mini-console overlay |
| `setAppStyleSheet(css)` | ❌ | Qt application-wide CSS — not applicable |
| `setUserWindowStyleSheet(name, css)` | 🚧 | CSS on dockview user window container |
| `getBorderTop()` | 🚧 | Returns top padding of main output area |
| `getBorderBottom()` | 🚧 | Returns bottom padding |
| `getBorderLeft()` | 🚧 | Returns left padding |
| `getBorderRight()` | 🚧 | Returns right padding |
| `getBorderSizes()` | 🚧 | Returns all four as a table |
| `setBorderTop(px)` | 🚧 | CSS padding-top on main output — creates space for overlays |
| `setBorderBottom(px)` | 🚧 | CSS padding-bottom |
| `setBorderLeft(px)` | 🚧 | CSS padding-left |
| `setBorderRight(px)` | 🚧 | CSS padding-right |
| `setBorderColor(r,g,b)` | 🚧 | Background color of the border/padding area |

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
| `centerview(roomID)` | 🚧 | Center map view, set player position |
| `getPath(fromID, toID)` | 🚧 | Pathfinding; populates `speedWalkDir`/`speedWalkPath` |
| `speedwalk(roomID [, walkcmd, delay])` | 🚧 | Execute path step by step |
| `pauseSpeedwalk()` | 🚧 | |
| `resumeSpeedwalk()` | 🚧 | |
| `stopSpeedwalk()` | 🚧 | |
| `getRoomName(roomID)` | 🚧 | |
| `getRoomCoordinates(roomID)` | 🚧 | |
| `getRoomExits(roomID)` | 🚧 | |
| `getRoomArea(roomID)` | 🚧 | |
| `getRoomEnv(roomID)` | 🚧 | |
| `getRooms()` | 🚧 | Table of all rooms |
| `getAreaTable()` | 🚧 | Table of all areas |
| `getAreaRooms(areaID)` | 🚧 | |
| `highlightRoom(roomID, ...)` | 🚧 | Color highlight on map |
| `unHighlightRoom(roomID)` | 🚧 | |
| `roomExists(roomID)` | 🚧 | |
| `addRoom(roomID)` | 🚧 | |
| `deleteRoom(roomID)` | 🚧 | |
| `setRoomName(roomID, name)` | 🚧 | |
| `setRoomCoordinates(roomID, x, y, z)` | 🚧 | |
| `setRoomArea(roomID, areaID)` | 🚧 | |
| `setExit(fromID, toID, dir)` | 🚧 | |
| `addSpecialExit(fromID, toID, cmd)` | 🚧 | |
| `removeSpecialExit(fromID, cmd)` | 🚧 | |
| `getSpecialExits(roomID)` | 🚧 | |
| `lockRoom(roomID, bool)` | 🚧 | |
| `lockExit(roomID, dir, bool)` | 🚧 | |
| `setRoomWeight(roomID, weight)` | 🚧 | |
| `getRoomWeight(roomID)` | 🚧 | |
| `getRoomUserData(roomID, key)` | 🚧 | |
| `setRoomUserData(roomID, key, value)` | 🚧 | |
| `saveMap(path)` / `loadMap(path)` | 🚧 | Via virtual filesystem |
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
| `string.title(s)` | 🚧 | Capitalize first letter |
| `string.cut(s, maxlen)` | 🚧 | Truncate to max length |
| `string.patternEscape(s)` | 🚧 | Escape Lua pattern magic chars |
| `string.genNocasePattern(s)` | 🚧 | Case-insensitive pattern generator |
| `f(str)` | 🚧 | String interpolation: `{expr}` inside strings |

---

## Table Utilities

| Function | Status | Notes |
|---|---|---|
| `table.contains(t, val)` | ✅ | |
| `table.size(t)` | ✅ | Count all keys including non-integer |
| `table.deepcopy(t)` | 🚧 | Full recursive copy |
| `table.keys(t)` | 🚧 | Return all keys as a list |
| `table.index_of(t, val)` | 🚧 | Numeric index of value |
| `table.union(t1, t2, ...)` | 🚧 | Merge tables |
| `table.complement(t1, t2)` | 🚧 | Elements in t1 absent from t2 |
| `table.intersection(t1, t2)` | 🚧 | Elements common to all tables |
| `table.is_empty(t)` | 🚧 | True if no elements |
| `table.update(t1, t2)` | 🚧 | Merge t2 into t1 recursively |
| `table.collect(t, fn)` | 🚧 | Filter key-value pairs |
| `table.n_flatten(t)` | 🚧 | Flatten nested table |
| `table.save(filename, t)` | 🚧 | Serialize to virtual filesystem |
| `table.load(filename)` | 🚧 | Deserialize from virtual filesystem |
| `spairs(t [, fn])` | 🚧 | Sorted-key iterator |
| `printTable(t)` | 🚧 | Print keys and values (cf. `display`) |

---

## Date / Time

| Function | Status | Notes |
|---|---|---|
| `getTime([returnAsTable, format])` | 🚧 | `new Date()` |
| `getEpoch()` | 🚧 | `Date.now() / 1000` |
| `getTimestamp([linenum])` | 🚧 | Timestamp stored per output line |

---

## Virtual Filesystem

| Function | Status | Notes |
|---|---|---|
| `io.exists(path)` | 🚧 | Check if path exists in virtual FS |
| `io.open(path, mode)` | 🚧 | Open a file handle (read/write/append) |
| `addFileWatch(path)` | 🚧 | Watch VFS path for changes |
| `removeFileWatch(path)` | 🚧 | |
| `getMudletHomeDir()` | 🚧 | Returns VFS root (e.g. `/mudix`) |
| `invokeFileDialog(type, title)` | 🚧 | Native `<input type="file">` picker |
| `table.save(filename, t)` | 🚧 | See Table Utilities |
| `table.load(filename)` | 🚧 | See Table Utilities |

---

## Profile / Session

| Function | Status | Notes |
|---|---|---|
| `getProfileName()` | 🚧 | Active connection name |
| `getNetworkLatency()` | 🚧 | Last ping ms |
| `getOS()` | 🚧 | Returns `"web"` |
| `getMudletVersion()` | 🚧 | Returns mudix version string |
| `debug(text)` | 🚧 | `console.log` |
| `remember(varname)` | 🚧 | Persist global via localStorage |
| `saveVars()` / `loadVars()` | 🚧 | Persist `remember()`-flagged vars |
| `shms(seconds)` | 🚧 | Seconds → `h:m:s` string, pure Lua |
| `xor(a, b)` | 🚧 | Boolean XOR, pure Lua |
| `compare(a, b)` | 🚧 | Deep equality, pure Lua |
| `f(str)` | 🚧 | String interpolation (see String section) |
| `openUrl(url)` | 🚧 | `window.open(url)` |
| `showNotification(title, text)` | 🚧 | Web Notifications API |
| `alert(secs)` | 🚧 | `document.title` flash or favicon badge |
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
| `playSoundFile(path [, vol, loops, ch])` | 🚧 | Web Audio API; path from virtual FS or URL |
| `loadSoundFile(path)` | 🚧 | Preload audio |
| `pauseSounds([channel])` | 🚧 | |
| `stopSounds([channel])` | 🚧 | |
| `getPlayingSounds()` | 🚧 | |
| `playMusicFile(path [, vol, loops, ch])` | 🚧 | Web Audio API |
| `stopMusic([channel])` | 🚧 | |
| `playVideoFile(path)` | 🚧 | HTML `<video>` element in overlay |
| `pauseVideos()` | 🚧 | |
| `stopVideos()` | 🚧 | |

---

## Text-to-Speech

| Function | Status | Notes |
|---|---|---|
| `ttsSpeak(text)` | 🚧 | Web Speech API `SpeechSynthesis` |
| `ttsQueue(text [, priority])` | 🚧 | |
| `ttsClearQueue()` | 🚧 | |
| `ttsPause()` | 🚧 | |
| `ttsResume()` | 🚧 | |
| `ttsSkip()` | 🚧 | |
| `ttsGetVoices()` | 🚧 | `speechSynthesis.getVoices()` |
| `ttsSetVoiceByName(name)` | 🚧 | |
| `ttsSetRate(rate)` | 🚧 | |
| `ttsSetPitch(pitch)` | 🚧 | |
| `ttsSetVolume(vol)` | 🚧 | |
| `ttsGetState()` | 🚧 | |

---

## Geyser OOP Framework

> Implementable in pure Lua once the overlay primitive API (`createLabel`, `createMiniConsole`, `createGauge`, `createCommandLine`, `moveWindow`, `resizeWindow`) exists. No additional JS required.

| Class | Status | Notes |
|---|---|---|
| `Geyser.Container` | 🚧 | Invisible layout organizer |
| `Geyser.Label` | 🚧 | Overlay label; wraps `createLabel` |
| `Geyser.MiniConsole` | 🚧 | Overlay console; wraps `createMiniConsole` |
| `Geyser.Gauge` | 🚧 | Progress bar; wraps `createGauge` |
| `Geyser.HBox` | 🚧 | Horizontal auto-layout |
| `Geyser.VBox` | 🚧 | Vertical auto-layout |
| `Geyser.CommandLine` | 🚧 | Overlay input; wraps `createCommandLine` |
| `Geyser.UserWindow` | 🚧 | Wraps dockview `openWindow` |
| `Geyser.ReflowContainer` | 🚧 | Wrapping layout |

---

## Not Applicable

| Feature | Reason |
|---|---|
| Discord Rich Presence | Requires Discord SDK |
| IRC client | Separate external service |
| Multi-profile management (`loadProfile`, `getProfiles`) | Single-connection web app |
| `setAppStyleSheet(css)` | Qt application-wide CSS |
| `spawn()` subprocess | No subprocess in browser |
| `getWindowsCodepage()` | Windows-only |
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
