# Mudlet API Implementation Checklist

Organised to match the [Mudlet wiki Lua Functions reference](https://wiki.mudlet.org/w/Manual:Lua_Functions). Each section below corresponds to a top-level category on that page; rows appear in the wiki's alphabetical order.

Status legend:
- ✅ Implemented and callable from Lua (JS-bound, pure-Lua, or wasmoon stdlib)
- ⚠️ Partial — skeleton exists, signature is incomplete, or pure-Lua impl is bundled but blocked by a missing dependency
- 🚧 Feasible — worth implementing
- ❌ N/A — fundamentally inapplicable (multi-profile, Qt-specific, Discord SDK, etc.). **These should still be bound as warning-emitting no-op stubs** so imported Mudlet scripts that reference them don't crash; the stub logs once per call site and returns a sensible default (`nil`/`false`/empty table).

Known blockers:
- Browser file-picker async/sync mismatch — blocks `invokeFileDialog`.

---

## Architecture Notes

### Overlay UI system
`createMiniConsole`, `createLabel`, `createGauge`, `createCommandLine` and friends are implemented as **absolutely-positioned HTML elements** rendered in an overlay layer on top of the main output area, mirroring Mudlet's pixel-coordinate layout.

- `moveWindow(name, x, y)` and `resizeWindow(name, w, h)` apply to overlay elements via CSS `left`/`top`/`width`/`height`.
- Dockview panels (opened via `openWindow`) follow dockview's own layout and are not absolutely positioned.
- `showWindow`/`hideWindow` and `raiseWindow`/`lowerWindow` apply to both overlay elements (CSS `display`/`z-index`) and dockview panels.

### Virtual filesystem
A profile-scoped IndexedDB VFS provides path-based file I/O from Lua. `getMudletHomeDir()` returns the VFS root; `io.open`, `io.exists`, `table.save`/`table.load`, `downloadFile`, `saveMap`/`loadMap`, and sound/video paths all resolve through it.

### Database
Mudlet's `DB.lua` is bundled and runs against `sqlite-wasm` through a `Luasql.lua` shim, so the entire `db:*` API works in the browser.

### Geyser
A subset of the Geyser OOP framework (`Container`, `Label`, `MiniConsole`, `Gauge`, `HBox`, `VBox`, `UserWindow`) is bundled in pure Lua on top of the overlay primitive API.

---

## Basic Essentials

| Function | Status | Notes |
|---|---|---|
| `debugc` | ✅ | Alias for `debug` — `console.debug` |
| `display(value)` | ✅ | Pretty-prints tables recursively |
| `echo([window,] text)` | ✅ | Main window; window arg routes to overlay/panel |
| `printDebug` | ✅ | Bound in LuaRuntime |
| `printError` | ✅ | Bound in LuaRuntime |
| `send(text [, echo])` | ✅ | Send command to MUD |

---

## Database Functions

All `db:*` calls run against `sqlite-wasm` via the Luasql shim; Mudlet's bundled `DB.lua` provides the high-level API unchanged.

| Function | Status | Notes |
|---|---|---|
| `db:add` | ✅ | DB.lua |
| `db:aggregate` | ✅ | DB.lua |
| `db:close` | ✅ | DB.lua |
| `db:create` | ✅ | DB.lua |
| `db:delete` | ✅ | DB.lua |
| `db:fetch` | ✅ | DB.lua |
| `db:fetch_sql` | ✅ | DB.lua |
| `db:get_database` | ✅ | DB.lua |
| `db:merge_unique` | ✅ | DB.lua |
| `db:query_by_example` | ✅ | DB.lua |
| `db:Timestamp` | ✅ | DB.lua |
| `db:Null` | ✅ | DB.lua |
| `db:safe_name` | ✅ | DB.lua |
| `db:set` | ✅ | DB.lua |
| `db:update` | ✅ | DB.lua |
| `db:_sql_convert` | ✅ | DB.lua internal — exposed |
| `db:_sql_values` | ✅ | DB.lua internal — exposed |

---

## Database Expressions

| Function | Status | Notes |
|---|---|---|
| `db:AND` | ✅ | DB.lua |
| `db:OR` | ✅ | DB.lua |
| `db:between` | ✅ | DB.lua |
| `db:eq` | ✅ | DB.lua |
| `db:exp` | ✅ | DB.lua |
| `db:gt` | ✅ | DB.lua |
| `db:gte` | ✅ | DB.lua |
| `db:in_` | ✅ | DB.lua |
| `db:is_nil` | ✅ | DB.lua |
| `db:is_not_nil` | ✅ | DB.lua |
| `db:like` | ✅ | DB.lua |
| `db:lt` | ✅ | DB.lua |
| `db:lte` | ✅ | DB.lua |
| `db:not_between` | ✅ | DB.lua |
| `db:not_eq` | ✅ | DB.lua |
| `db:not_in` | ✅ | DB.lua |
| `db:not_like` | ✅ | DB.lua |

---

## Database Transactions

Transactions are driven through the Luasql connection (`conn:commit()`/`conn:rollback()`); DB.lua's auto-commit wrapping handles the documented `db:_*` entry points.

| Function | Status | Notes |
|---|---|---|
| `db:_begin` | ✅ | Via DB.lua autocommit toggling |
| `db:_commit` | ✅ | Via `conn:commit()` |
| `db:_end` | ✅ | Closes transaction window |
| `db:_rollback` | ✅ | Via `conn:rollback()` |

---

## Date & Time Functions

| Function | Status | Notes |
|---|---|---|
| `datetime:parse` | ✅ | DateTime.lua |
| `getEpoch()` | ✅ | JS-exposed (`Date.now() / 1000`) |
| `getTime([returnAsTable, format])` | ✅ | Bridge.lua — full Qt QDateTime token formatting |
| `getTimestamp([window,] lineNumber)` | ✅ | Bridge.lua → `__getTimestamp` → `"hh:mm:ss.zzz"` string. Each `AnsiAwareBuffer` carries a construction-time `timestamp`; `Console.getLineTimestamp` reads it (1-based, matching `getLines`). `(nil, errMsg)` when out of range |
| `shms(seconds)` | ✅ | DateTime.lua |

---

## File System Functions

| Function | Status | Notes |
|---|---|---|
| `io.exists(path)` | ✅ | Other.lua (uses `io.open`) backed by ProfileVFS |
| `lfs.attributes(path [, attrib])` | ✅ | VFS.lua exposes the full `lfs` table over the profile VFS — `attributes` returns `{mode, size, modification, access}` (or the single named attribute). `lfs.currentdir`/`chdir`/`mkdir`/`rmdir`/`dir`/`touch`/`isfile`/`isdir` also wired |
| `openMudletHomeDir()` | ✅ | `openUrl("file:")` routes to the VFS file browser |
| `saveProfile([name])` | ✅ | Forces the debounced VFS flush to IndexedDB (see Miscellaneous Functions) |

---

## Mapper Functions

| Function | Status | Notes |
|---|---|---|
| `addAreaName(name)` | ✅ | Bridge.lua |
| `addCustomLine(roomID, toID, direction, style, color, arrow)` | ✅ | `MapStore.addCustomLine` — `toID` is a target room id (same area) or a `{ {x,y,z}, … }` point list. `style` is a Mudlet pen-style name; Bridge.lua flattens the id_to/color tables to a `R:`/`P:` string + r,g,b. Round-trips through `getCustomLines`/`removeCustomLine` |
| `addMapEvent(uniquename, event, parent, displayName, ...)` | ✅ | Map context-menu event registration |
| `addMapMenu(name, parent, displayName)` | ✅ | Registers a submenu in the map right-click menu; `MapPanel` surfaces it as a container node so `addMapEvent` entries whose `parent` names it nest underneath. Pairs with `getMapMenus`/`removeMapMenu` |
| `addRoom(roomID)` | ✅ | JS-exposed |
| `addSpecialExit(fromID, toID, cmd)` | ✅ | JS-exposed |
| `auditAreas()` | ✅ | Rebuilds each area's `rooms[]` from the authoritative `room.area` back-pointers (drops dangling ids, re-files missing rooms); returns a summary `{checkedAreas, checkedRooms, fixedAreas, orphanRooms, danglingRefs}` (Mudlet returns nothing) |
| `centerview(roomID)` | ✅ | JS-exposed; also sets the player room (matches Mudlet) |
| `clearAreaUserData(areaID)` | ✅ | Bridge.lua → `__clearAreaUserData`; `(false, errMsg)` when area missing |
| `clearAreaUserDataItem(areaID, key)` | ✅ | Bridge.lua → `__clearAreaUserDataItem` |
| `clearMapSelection()` | ✅ | Clears the room-selection set + center. `MapSelectionOverlay` redraws. Returns false when already empty |
| `clearMapUserData()` | ✅ | JS-exposed |
| `clearMapUserDataItem(key)` | ✅ | JS-exposed |
| `clearRoomUserData(roomID)` | ✅ | Bridge.lua → `__clearRoomUserData` |
| `clearRoomUserDataItem(roomID, key)` | ✅ | Bridge.lua → `__clearRoomUserDataItem` |
| `clearSpecialExits(roomID)` | ✅ | Removes special exits and the locks/doors/custom lines keyed by their commands |
| `closeMapWidget()` | ✅ | Closes the dockable map widget (id `map`); returns false if none open |
| `connectExitStub(fromID, dir)` / `(fromID, toID[, dir])` | ✅ | Direction-only finds the nearest in-area room with a matching reverse stub (Mudlet's unit-vector/compSign search); toID-only requires exactly one reverse-stub pair |
| `createMapLabel(areaID, text, x, y, z, fg, bg, …)` | ✅ | Adds a text label (new per-area id) to `MapStore`; round-trips through `getMapLabels`/`getMapLabel` and binary save, and is painted by the renderer (`mudlet-map-renderer` `ScenePipeline.renderLabels` → `labelToShape`, default `labelRenderMode:"image"`). `-1` when the area is missing |
| `createMapImageLabel(areaID, imagePath, x, y, z, w, h, zoom, …)` | ✅ | Image-label sibling of `createMapLabel`; stores the image in the label `pixMap` (surfaced as `Pixmap`), which `MudixMapReader` patches through to the renderer so it paints. `scaling` arg is the inverse of the stored `noScaling`. `-1` when the area is missing |
| `createMapper(x, y, w, h)` | ✅ | Singleton embedded mapper widget sharing MapStore with the dock |
| `createRoomID([minimumID])` | ✅ | JS-exposed |
| `deleteArea(areaID\|name)` | ✅ | JS-exposed |
| `deleteMap()` | ✅ | Wipes every room/area/label back to a single empty default area |
| `deleteMapLabel(areaID, labelID)` | ✅ | Removes the label by id; false when the area or id is unknown |
| `deleteRoom(roomID)` | ✅ | JS-exposed |
| `disableMapInfo(label)` | ✅ | Toggles a registered info contributor off |
| `enableMapInfo(label)` | ✅ | Toggles a registered info contributor on |
| `exportAreaImage(areaID, filePath [, zLevel])` | ✅ | Renders the area (optionally one z-level) to a PNG in the profile VFS via a headless `mudlet-map-renderer` `PngBytesExporter` (the live view is untouched). The whole area is fitted into the image; hidden rooms follow the current viewing/editing mode. `(true, absPath)` / `(false, errMsg)` via Bridge.lua. Requires the map widget open (Mudlet requires the mapper open) |
| `getAllAreaUserData(areaID)` | ✅ | Bridge.lua → `__getAllAreaUserData` |
| `getAllMapUserData()` | ✅ | JS-exposed |
| `getAllRoomEntrances(roomID)` | ✅ | Sorted, de-duped list of rooms with a stock or special exit into this one |
| `getAllRoomUserData(roomID)` | ✅ | Bridge.lua → `__getAllRoomUserData` |
| `getAreaExits(areaID[, fullData])` | ✅ | Default → sorted id list; `fullData` → `{ [fromRoomID] = { [exit] = toRoomID } }` |
| `getAreaRooms(areaID)` | ✅ | JS-exposed (0-indexed) |
| `getAreaRooms1(areaID)` | ✅ | Bridge.lua — 1-based reindex |
| `getAreaTable()` | ✅ | JS-exposed |
| `getAreaTableSwap()` | ✅ | Bridge.lua re-keys numeric-string ids back to integers |
| `getAreaUserData(areaID, key)` | ✅ | Bridge.lua → `__getAreaUserData` |
| `getCustomEnvColorTable()` | ✅ | Bridge.lua |
| `getCustomLines(roomID)` | ✅ | `{ dir = { attributes={color,style,arrow}, points={[0]={x,y,z},...} } }` |
| `getCustomLines1(roomID)` | ✅ | Bridge.lua — 1-indexed point arrays |
| `getDoors(roomID)` | ✅ | JS-exposed |
| `getExitStubs(roomID)` | ✅ | JS-exposed; 0-indexed (wasmoon array convention, matches Mudlet) |
| `getExitStubs1(roomID)` | ✅ | Bridge.lua — 1-indexed |
| `getExitWeights(roomID)` | ✅ | JS-exposed; `{exit=weight}` |
| `getGridMode(areaID)` | ✅ | Bridge.lua → `__getGridMode`; `(false, errMsg)` when area missing |
| `getHiddenRooms(areaID)` | ✅ | Bridge.lua — 1-indexed array of room ids in the area whose hidden flag is set; `(false, errMsg)` when the area is missing |
| `getMapEvents()` | ✅ | Bridge.lua |
| `getMapLabel(areaID, labelID\|labelText)` | ✅ | Bridge.lua |
| `getMapLabels(areaID)` | ✅ | Bridge.lua → `__getMapLabels` |
| `getMapMenus()` | ✅ | `{ [menuName] = { ["parent"], ["display name"] } }`; Bridge.lua reshapes the JS array |
| `getMapSelection()` | ✅ | `{ rooms = {1-indexed roomIDs}, center = roomID }`. Selection lives on `MapStore` with a dedicated subscribe channel; UI: left-click selects + sets center, ctrl/cmd-click toggles, click on empty area clears. `registerMapInfo` callbacks now receive the real selection size + center room |
| `getMapUserData(key)` | ✅ | Bridge.lua |
| `getMapZoom([areaID])` | ✅ | Mudlet-compatible zoom semantics (units across the shorter viewport edge). `setMapZoom` enforces min of 3.0; `areaID` accepted for compat |
| `getPath(fromID, toID)` | ✅ | A* via `__getPath`; populates `speedWalkPath`/`speedWalkDir`/`speedWalkWeight` (1-indexed) |
| `getPlayerRoom()` | ✅ | Returns the id last passed to `centerview`; `nil` when unset/deleted |
| `getRoomArea(roomID)` | ✅ | JS-exposed |
| `getRoomAreaName(roomID)` | ✅ | JS-exposed |
| `getRoomChar(roomID)` | ✅ | Bridge.lua |
| `getRoomCharColor(roomID)` | ✅ | Bridge.lua → r, g, b, a; nil when unset |
| `getRoomCoordinates(roomID)` | ✅ | Bridge.lua → `__getRoomCoordinates` |
| `getRoomEnv(roomID)` | ✅ | JS-exposed |
| `getRoomExits(roomID)` | ✅ | JS-exposed |
| `getRoomHashByID(roomID)` | ✅ | Bridge.lua |
| `getRoomHidden(roomID)` | ✅ | Bridge.lua — bool, `(false, errMsg)` when the room is missing. MapStore side-table; renderer's RoomLens skips hidden rooms in viewing mode (editing mode shows them) |
| `getRoomIDbyHash(hash)` | ✅ | JS-exposed |
| `getRoomName(roomID)` | ✅ | Bridge.lua → `__getRoomName` |
| `getRooms()` | ✅ | JS-exposed |
| `getRoomsByPosition(areaID, x, y, z)` | ✅ | JS-exposed (0-indexed) |
| `getRoomsByPosition1(areaID, x, y, z)` | ✅ | Bridge.lua — 1-based reindex |
| `getRoomUserData(roomID, key)` | ✅ | Bridge.lua → `__getRoomUserData` |
| `getRoomUserDataKeys(roomID)` | ✅ | Bridge.lua — re-indexes JS 0-based array to 1-based |
| `getRoomWeight(roomID)` | ✅ | JS-exposed; false when missing |
| `getSpecialExits(roomID [, listAllExits])` | ✅ | `{[exitRoomID]={[cmd]="0"\|"1"}}`; lowest-weight command per room unless `listAllExits` |
| `getSpecialExitsSwap(roomID)` | ✅ | JS-exposed; `{cmd=toId}` |
| `gotoRoom(targetRoomID)` | ✅ | Pure Lua (Bridge.lua): `getPath` then `send`s the moves. mudix sends immediately (no autonomous timed-walk engine) |
| `hasSpecialExitLock(fromID, toID, cmd)` | ✅ | `toID` ignored; returns the lock boolean or `(nil, errMsg)` when missing |
| `highlightRoom(roomID, …)` | ✅ | JS-exposed — color1/color2 + radius + alpha |
| `killMapInfo(label)` | ✅ | Removes a contributor entirely |
| `loadJsonMap(path)` | ✅ | JS-exposed via `MapStore.loadFromJsonString`; raises `sysMapLoadEvent` on success |
| `loadMap(path)` | ✅ | JS-exposed |
| `lockExit(roomID, dir, bool)` | ✅ | `MapStore.lockExit` mutates `room.exitLocks`, which `__getPath` reads — locks set from Lua are honoured by pathfinding |
| `hasExitLock(roomID, dir)` | ✅ | `MapStore.hasExitLock`; reads `room.exitLocks` directly. Direction accepts the 1-12 int or names ("north"/"n"/…) |
| `lockRoom(roomID, bool)` | ✅ | JS-exposed; honoured by pathfinding |
| `lockSpecialExit(fromID, toID, cmd, lockIfTrue)` | ✅ | Bridge.lua drops the (Mudlet-ignored) `toID` |
| `moveMapWidget(x, y)` | ✅ | JS-exposed (alias for `moveWindow` on the embedded mapper) |
| `openMapWidget([…])` | ✅ | Opens the dockable mapper panel |
| `pauseSpeedwalk()` | ✅ | Pure Lua via Other.lua |
| `registerMapInfo(label, fn)` | ✅ | `MapStore.registerMapInfo` keyed by label; callback receives `(roomId, selectionSize, areaId, displayedAreaId)` and returns `(text, bold?, italic?, r?, g?, b?)`. New contributors land disabled — call `enableMapInfo(label)` to show. MapPanel re-evaluates every enabled contributor on map updates. Two built-in native contributors mirror Mudlet's defaults: **Short** (`name / id (area)`) and **Full** (area extent + room id/position with selection-aware suffix & styling); **Full** is enabled by default, both are evaluated without Lua and can't be `killMapInfo`'d. The map hamburger menu's **Map info overlays** submenu toggles every contributor (built-in + script) with checkboxes plus a **None** entry |
| `resumeSpeedwalk()` | ✅ | Other.lua |
| `removeCustomLine(roomID, direction)` | ✅ | Direction = 1-12/name/special command; `false` when missing |
| `removeMapEvent(uniquename)` | ✅ | Pairs with `addMapEvent` |
| `removeMapMenu(name)` | ✅ | Removes a registered submenu; true if it existed |
| `removeSpecialExit(fromID, cmd)` | ✅ | JS-exposed |
| `resetRoomArea(roomID)` | ✅ | Bridge.lua → moves the room to the void area (-1) |
| `resizeMapWidget(w, h)` | ✅ | JS-exposed (alias for `resizeWindow` on the embedded mapper) |
| `roomExists(roomID)` | ✅ | JS-exposed |
| `roomLocked(roomID)` | ✅ | JS-exposed; nil when missing |
| `saveJsonMap(path)` | ✅ | Same `MudletMap` shape as `saveMap`, just JSON |
| `saveMap(path)` | ✅ | Serialises MapStore via `writeMapToBuffer` to VFS / IDB |
| `searchAreaUserData([key[, value]])` | ✅ | 1-indexed |
| `searchRoom(roomID \| name[, caseSensitive[, exactMatch]])` | ✅ | By id → name (`false` on miss); by name → `{ [roomID] = name }` |
| `searchRoomUserData([key[, value]])` | ✅ | 1-indexed |
| `setAreaName(idOrName, newName)` | ✅ | Bridge.lua |
| `setAreaUserData(areaID, key, value)` | ✅ | JS-exposed; false when missing |
| `setCustomEnvColor(envID, r, g, b, a)` | ✅ | JS-exposed |
| `setDoor(roomID, exitCmd, type)` | ✅ | JS-exposed |
| `setExit(fromID, toID, dir)` | ✅ | JS-exposed |
| `setExitStub(roomID, dir, bool)` | ✅ | JS-exposed |
| `setExitWeight(roomID, exitCommand, weight)` | ✅ | Weight 0 resets to destination-room weight; rejects negatives/unknown exits |
| `setGridMode(areaID, bool)` | ✅ | `api.map.setGridMode`; false when missing |
| `setMapUserData(key, value)` | ✅ | JS-exposed |
| `setMapZoom(zoom[, areaID])` | ✅ | See `getMapZoom` |
| `setRoomArea(roomID, areaID)` | ✅ | JS-exposed |
| `setRoomChar(roomID, char)` | ✅ | JS-exposed |
| `setRoomCharColor(roomID, r, g, b [, a])` | ✅ | Side-table on MapStore (upstream `MudletRoom` has no charColor field); cleared by map reset |
| `setRoomCoordinates(roomID, x, y, z)` | ✅ | JS-exposed |
| `setRoomEnv(roomID, envID)` | ✅ | JS-exposed |
| `setRoomHidden(roomID, bool)` | ✅ | JS-exposed via MapStore side-table; round-trips through binary maps via the `system.fallback_hidden` userData key (Mudlet v20-compatible). False when the room is missing |
| `setRoomIDbyHash(hash, roomID)` | ✅ | JS-exposed |
| `setRoomName(roomID, name)` | ✅ | JS-exposed |
| `setRoomUserData(roomID, key, value)` | ✅ | JS-exposed |
| `setRoomWeight(roomID, weight)` | ✅ | JS-exposed; rejects negatives |
| `speedwalk(roomID [, walkcmd, delay])` | ✅ | Pure Lua via Other.lua (`send` + `tempTimer`) |
| `stopSpeedwalk()` | ✅ | Other.lua |
| `unHighlightRoom(roomID)` | ✅ | JS-exposed |
| `unsetRoomCharColor(roomID)` | ✅ | Drops the side-table entry; false when the room is missing or had no override |
| `updateMap()` | ✅ | Forces the map panel to re-read MapStore and redraw |

mudix-specific extras (not on the wiki): `getMapMode`/`setMapMode("viewing"\|"editing")`, `getMapRoomSize`/`setMapRoomSize`, `setMapBackgroundColor`, `removeCustomEnvColor`.

---

## Miscellaneous Functions

| Function | Status | Notes |
|---|---|---|
| `addFileWatch(path)` | ✅ | Tracks resolved VFS paths, fires `sysPathChanged` on mutation |
| `addSupportedTelnetOption(option)` | ✅ | Registers a telnet option byte so the next IAC WILL/DO is auto-accepted |
| `alert([secs])` | ✅ | Flashes `document.title` for `secs` (default 10). No-op while focused |
| `announce(text [, processing])` | ✅ | ARIA live region; `processing` (`importantall`/`importantmostrecent` → assertive, else polite) matches Mudlet's politeness mapping |
| `appendLog(text)` | ✅ | Appends a line (type `appendLog`) to the active `SessionLogger`; false when logging is off |
| `cfeedTriggers(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `clearVisitedLinks()` | ✅ | True no-op — mudix tracks no visited-link state, so there is nothing to clear (bound for script portability) |
| `closeMudlet()` | ✅ | Closes the active profile — disconnects then returns to the connection screen (callback wired by `ProfileSession`) |
| `compare(a, b)` | ✅ | Other.lua — alias for `_comp` deep equality |
| `deleteAllNamedEventHandlers([type])` | ✅ | IDManager.lua |
| `deleteNamedEventHandler(name)` | ✅ | IDManager.lua |
| `denyCurrentSend()` | ✅ | Cancels the currently-dispatched send |
| `dfeedTriggers(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `disableModuleSync(name)` | ✅ | Marks the module non-syncing in profile state |
| `enableModuleSync(name)` | ✅ | Marks the module syncing |
| `expandAlias(text [, echo])` | ✅ | `ScriptingAPI.expandAlias` |
| `feedTriggers(text)` | ✅ | Feeds text through trigger pipeline + shows in output |
| `getCharacterName()` | ✅ | mudix maps character→profile (one character per profile); returns the profile name (same as `getProfileName`), "" when unset |
| `getConfig(key)` | ✅ | Bound on profile config slice |
| `getCommandSeparator()` | ✅ | Reads the profile's `commandSeparator` (default `;;`) |
| `getModuleInfo(name, key)` | ✅ | Bridge.lua |
| `getModulePath(name)` | ✅ | Absolute VFS path of a module's XML — `xmlVfsPath` verbatim, else `<profilePath>/<name>/<xmlPath>`; nil when not an installed module |
| `getModulePriority(name)` | ✅ | JS-exposed |
| `getModules()` | ✅ | JS-exposed |
| `getModuleSync(name)` | ✅ | JS-exposed |
| `getMudletHomeDir()` | ✅ | VFS.lua — alias for `getMudixProfilePath()` |
| `getMudletInfo()` | ✅ | Echoes a diagnostic block (profile, server encoding, platform/user-agent) to the main window |
| `getMudletVersion([mode])` | ✅ | Supports `nil`/`"string"`/`"major"`/`"minor"`/`"revision"`/`"build"`/`"table"` |
| `getNamedEventHandlers()` | ✅ | IDManager.lua |
| `getNewIDManager()` | ✅ | IDManager.lua factory |
| `getOS()` | ✅ | Sniffed from user agent → `"windows"`/`"mac"`/`"linux"`/`"freebsd"`/`"openbsd"`/`"netbsd"`/`"unknown"` |
| `getPackages()` | ✅ | JS-exposed |
| `getPackageInfo(name [, key])` | ✅ | Merged table: manifest fields (name/title/author/version/description/created/icon/installed) overlaid with `setPackageInfo` overrides; single-key form returns `""` when absent |
| `getPausedMusic()` / `getPausedSounds()` | ✅ | Always empty — mudix's Web Audio backend stops rather than pauses sources, so nothing sits paused (kept for parity) |
| `getPausedVideos()` | ✅ | Lists genuinely-paused `<video>` elements (`element.paused`), optionally name-filtered. 1-indexed `{name, path, volume}` |
| `getPlayingMusic()` | ✅ | Sister of `getPlayingSounds` for the music channel; 1-indexed `{name, key, tag, volume}` |
| `getPlayingVideos()` | ✅ | Currently-playing `<video>` elements, optionally name-filtered. 1-indexed `{name, path, volume}` |
| `getPlayingSounds([filter])` | ✅ | 1-based array of `{name, key, tag, volume}`; optional name/key/tag filter |
| `getProfileName()` | ✅ | JS-exposed |
| `getServerEncoding()` / `setServerEncoding(name)` / `getServerEncodingsList()` | ✅ | Exposes `MudClient`'s CHARSET (RFC 2066) decoder. `getServerEncoding` → current IANA name (default "utf-8"); `setServerEncoding` validates via `normalizeCharsetName` and swaps the `TextDecoder` (false when unsupported); `getServerEncodingsList` → 1-indexed `SUPPORTED_SERVER_ENCODINGS` (UTF-8, ISO-8859-x, Windows-125x, KOI8-R/U) |
| `getWindowsCodepage()` | ✅ | Returns `"65001"` (UTF-8) on every platform |
| `hfeedTriggers(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `holdingModifiers(number)` | ✅ | Exact-match against the live held modifiers (Qt bitmask, as in `mudlet.keymodifier`). A `heldModifiers` tracker snapshots shift/ctrl/alt/meta off every keyboard/pointer event |
| `installModule(path)` | ✅ | JS-exposed |
| `installPackage(path)` | ✅ | JS-exposed |
| `killAnonymousEventHandler(id)` | ✅ | Other.lua: removes handler by ID |
| `loadMusicFile(path \| {name=…})` | ✅ | `SoundManager.preload` |
| `loadSoundFile(path \| {name=…})` | ✅ | `SoundManager.preload` |
| `loadVideoFile(path \| {name=…})` | ✅ | Preload variant of `playVideoFile` — `VideoManager.preload` fetches + caches a VFS-backed video so the first play has no fetch latency (fire-and-forget; http(s)/data/blob URLs need no preloading) |
| `mudletOlderThan(major, minor, revision)` | ✅ | Built on `getMudletVersion("table")` |
| `openWebPage(url)` | ✅ | Routes to `openUrl` |
| `playMusicFile(path \| {…})` | ✅ | `SoundManager` (Web Audio + VFS or http(s) URL) |
| `playSoundFile(path \| {…})` | ✅ | `SoundManager` |
| `playVideoFile(path \| {…})` | ✅ | `VideoManager`; absolutely-positioned `<video>` on the main viewport. `loops=-1` plays indefinitely. Fires `sysMediaFinished(name, path)` on natural end |
| `pauseMusic([channel])` | ✅ | Web Audio can't truly pause — fades out + stops matching music sources (optionally tag-filtered), mirroring `pauseSounds`. Re-trigger `playMusicFile` to "resume" |
| `pauseSounds([channel])` | ✅ | Web Audio source nodes can't truly pause — stops sources (optionally tag-filtered). Re-trigger `playSoundFile` to "resume" |
| `pauseVideos()` | ✅ | Pauses every active `<video>` element |
| `purgeMediaCache()` | ✅ | Drops every decoded-audio buffer; active playback unaffected |
| `receiveMSP(payload)` | ✅ | Parses the payload through a fresh `MspParser` and re-emits each `!!SOUND`/`!!MUSIC` command as a `msp` session event, so `ScriptingEngine.handleMspCommand` plays it through `SoundManager`. Returns true when ≥1 command parsed |
| `registerAnonymousEventHandler(event, fn)` | ✅ | Other.lua override tracks IDs in `handlerIdsToHandlers` |
| `registerNamedEventHandler(name, event, code)` | ✅ | IDManager.lua |
| `reloadModule(name)` | ✅ | JS-exposed |
| `removeFileWatch(path)` | ✅ | Stops watching a path |
| `resetLinkStyle(labelName)` / `setLinkStyle(labelName, linkColor, visitedColor[, underline])` | ✅ | Styles the `<a>` links inside a label. `LabelManager` stores the per-label `linkStyle`; `LabelOverlay` injects a `<style>` scoped via the label's `data-mudix-label` selector (`a { color; text-decoration }`, `a:visited { color }`). `underline` defaults to true |
| `resetProfile()` | ✅ | Reloads the profile as if just reopened: clears every UI surface (windows, labels, gauges, command lines, scroll boxes; stops sound/video), recreates the Lua runtime (fresh globals + event handlers), and re-runs all scripts/aliases/triggers/timers/keys from current profile state, re-firing `sysLoadEvent`. Deferred to a fresh task (it closes the running `lua_State`), so call it from an alias / command line, not a script-item — matching Mudlet's own guidance. mudix reloads from the live store, not a re-read of disk |
| `resumeNamedEventHandler(name)` | ✅ | IDManager.lua |
| `saveProfile([name])` | ✅ | Bridge.lua → `__mudix_saveProfile` forces the debounced VFS flush through to IndexedDB; `(nil, errMsg)` when no VFS, else `true, path`. `name` ignored (single-profile) |
| `setConfig(key, value)` | ✅ | JS-exposed |
| `setMergeTables(...)` | ✅ | Pure Lua (Bridge.lua), mirroring `Host::mGMCP_merge_table_keys`. Accumulates GMCP keys (dotted, e.g. `"Char.Status"`) into `mudlet.mergeTables`; `__mudix_set_gmcp` merges those keys' incoming payloads into the existing `gmcp` sub-table instead of replacing it |
| `setModuleInfo(name, key, value)` | ✅ | Stores a custom info field (in-memory override map) surfaced by `getModuleInfo`; always true |
| `setModulePriority(name, n)` | ✅ | JS-exposed |
| `setPackageInfo(name, key, value)` | ✅ | Stores a custom info field (in-memory override map) surfaced by `getPackageInfo`; always true |
| `showNotification(title, text [, expirySecs])` | ✅ | Web Notifications API; gated on the Settings opt-in |
| `spawn(...)` | ❌ stub | No subprocess in the browser; stub returns `false` with a warning |
| `startLogging(bool)` | ✅ | Toggles the per-profile `SessionLogger`. mudix records to IndexedDB (the same store the toolbar Logs button browses) |
| `stopAllNamedEventHandlers([type])` | ✅ | IDManager.lua |
| `stopMusic([channel])` | ✅ | `SoundManager` |
| `stopNamedEventHandler(name)` | ✅ | IDManager.lua |
| `stopSounds([channel])` | ✅ | JS-exposed |
| `stopVideos()` | ✅ | Removes every active `<video>` element; revokes blob: URLs |
| `timeframe(s)` | ✅ | Other.lua humanises seconds |
| `translateTable(t)` | ✅ | Other.lua |
| `uninstallModule(name)` | ✅ | JS-exposed |
| `uninstallPackage(name)` | ✅ | JS-exposed |
| `unzipAsync(zipPath, destDir)` | ✅ | JS-exposed; fires `sysUnzipDone`/`sysUnzipError` |
| `yajl.to_string` / `yajl.to_value` | ✅ | `Yajl.lua` (pure-Lua encoder) + `yajl.ts` (JS `JSON.parse` decoder with 1-indexed-array remap and a `yajl.null` sentinel). Loaded at startup via `setupYajl` |

---

## Mudlet Object Functions

| Function | Status | Notes |
|---|---|---|
| `addCmdLineSuggestion([name,] text)` | ✅ | Main command bar; `name` argument is dropped (Tab-completion merged with command history) |
| `adjustStopWatch(id\|name, seconds)` | ✅ | Add (or subtract) seconds |
| `ancestors(id, type)` | ✅ | Ancestor chain (immediate parent → root) as 1-indexed `{id, name, node, isActive}`; `node` is "package"/"group"/"item". `(false, errMsg)` when no item of that type has the id |
| `appendCmdLine([name,] text)` | ✅ | Routes to overlay cmd lines (`createCommandLine`), per-userwindow cmd lines, or the main bar |
| `appendScript(name, code)` | ✅ | JS-exposed |
| `clearCmdLine([name])` | ✅ | Routes to overlay cmd lines, per-userwindow cmd lines, or the main bar |
| `clearCmdLineSuggestions([name])` | ✅ | Main bar |
| `clearProfileInformation()` | ✅ | Resets the profile description to `""` |
| `createStopWatch([name], [autostart])` | ✅ | `performance.now()`-based high-res stopwatch (`StopwatchManager`). Named watches default autostart off |
| `deleteAllNamedTimers(parent)` | ✅ | IDManager.lua |
| `deleteAllNamedTriggers(parent)` | ✅ | IDManager.lua |
| `deleteNamedTimer(parent, name)` | ✅ | IDManager.lua |
| `deleteNamedTrigger(parent, name)` | ✅ | IDManager.lua |
| `deleteStopWatch(id\|name)` | ✅ | |
| `disableAlias(name)` | ✅ | |
| `disableKey(name)` | ✅ | Cascades to children |
| `disableScript(name)` | ✅ | JS-exposed |
| `disableTimer(name)` | ✅ | JS-exposed |
| `disableTrigger(name)` | ✅ | JS-exposed |
| `enableAlias(name)` | ✅ | |
| `enableKey(name)` | ✅ | Cascades to children |
| `enableScript(name)` | ✅ | JS-exposed |
| `enableTimer(name)` | ✅ | JS-exposed |
| `enableTrigger(name)` | ✅ | JS-exposed |
| `exists(name, type)` | ✅ | `ScriptingAPI.exists` |
| `findItems(name, type [, exact [, caseSensitive]])` | ✅ | 1-indexed numeric ids of matching items/groups. `exact`/`caseSensitive` default true (Mudlet). type as for `exists` |
| `getButtonState(name)` | ✅ | Two-state button pressed state; nil when missing |
| `getCmdLine([name])` | ✅ | Reads the live main bar or a named overlay command line |
| `getConsoleBufferSize([window])` | ✅ | Bridge.lua → linesLimit, batchSize; nil when console missing |
| `getExitStubsNames(roomID)` | ✅ | Stub direction names ("north"/…/"other"), 1-indexed |
| `getNamedTimers(parent)` | ✅ | IDManager.lua |
| `getNamedTriggers(parent)` | ✅ | IDManager.lua |
| `getProfileInformation()` | ✅ | Returns the profile's free-text description (`""` when unset); stored in `ProfileSettings.description` |
| `getProfileStats()` | ✅ | `{triggers={total,temp,active,patterns={total,active}}, aliases=, timers=, keys=, scripts={total,temp,active}, gifs={total,active}}`. mudix keeps no temp items in the tree (`temp` always 0) and has no gif tracker (`gifs` always 0) |
| `getProfiles()` | ✅ | Single-connection web app — returns `{getProfileName()}` (1-element list) so callers that iterate profiles still work |
| `getStopWatches()` | ✅ | Re-keys to integer ids → `{ name, isRunning, isPersistent, elapsedTime }` |
| `getStopWatchTime(id\|name)` | ✅ | Elapsed seconds without stopping |
| `getStopWatchBrokenDownTime(id\|name)` | ✅ | `{negative, days, hours, minutes, seconds, milliSeconds, decimalSeconds}` off the proxy; `false` on miss |
| `getScript(name [, pos])` | ✅ | → `code, count` for the pos-th (1-indexed) script named `name`; ("", 0) on miss. Bridge.lua unpacks the `{code,count}` from `__getScript`. Unblocks `appendScript`'s code-preserving path (Other.lua) |
| `invokeFileDialog(type, title)` | 🚧 | Blocked on a sync/async design decision — browser pickers are async; Mudlet's `local p = invokeFileDialog(...)` is synchronous |
| `isActive(name, type [, checkAncestors])` | ✅ | Count active items by name/id |
| `isAncestorsActive(id, type)` | ✅ | True when every ancestor group of the item is enabled (item's own state ignored). `(false, errMsg)` when no item of that type has the id |
| `isPrompt()` | ✅ | True when the current trigger fired against a prompt line |
| `killAlias(id)` | ✅ | |
| `killKey(id)` | ✅ | |
| `killTimer(id)` | ✅ | |
| `killTrigger(name\|id)` | ✅ | String → name-based delete; numeric → temp-trigger disposer |
| `loadProfile(name)` | ❌ stub | No multi-profile switching; bind as a warning-emitting no-op stub returning `false` |
| `permAlias(name, parent, pattern, code)` | ✅ | Pattern is a single PCRE string (Mudlet TAlias.mRegexCode). Returns the new id, or -1 |
| `permGroup(name, type [, parent])` | ✅ | Creates a group node in the requested family |
| `permPromptTrigger(name, parent, code)` | ✅ | Persistent trigger firing on every server prompt (GA/EOR); single `prompt`-type pattern, never a group. Returns the new id or -1 |
| `permRegexTrigger(name, parent, patterns, code)` | ✅ | `patterns` is a table of regex strings (empty table → creates a trigger group). Bridge.lua joins to \x01 and the JS binding splits it back |
| `permBeginOfLineStringTrigger(name, parent, patterns, code)` | ✅ | Like `permSubstringTrigger` but each literal pattern matches only at the start of the line (`startOfLine` kind). Empty patterns array → trigger group |
| `permSubstringTrigger(name, parent, patterns, code)` | ✅ | Each pattern is a literal substring. Empty patterns array creates a trigger group |
| `permScript(name, parent, code)` | ✅ | `ScriptingEngine.createPermScript` creates a saved Lua script node under a script group (parent `""` → root). Returns the new id or -1. Bound via `__mudix_permScript` + Bridge.lua wrapper |
| `permTimer(name, parent, delay, code)` | ✅ | Persistent one-shot timer; returns the new id or -1 |
| `permKey(name, parent, modifier, key, code)` | ✅ | `modifier` is the Qt::KeyboardModifier int (1=shift, 2=ctrl, 4=alt, 8=meta; -1 → none). `key` accepts a Qt::Key int or a KeyboardEvent.code string |
| `printCmdLine([name,] text)` | ✅ | Routes to overlay cmd lines, per-userwindow cmd lines, or the main bar |
| `raiseEvent(name, ...)` | ✅ | |
| `raiseGlobalEvent(name, ...)` | ❌ stub | Multi-profile only; stub forwards to local `raiseEvent` so single-profile scripts still see the event |
| `registerNamedTimer(parent, name, delay, code)` | ✅ | IDManager.lua |
| `registerNamedTrigger(parent, name, pattern, code)` | ✅ | IDManager.lua |
| `remainingTime(id)` | ✅ | JS-exposed |
| `removeCmdLineSuggestion([name,] text)` | ✅ | Main bar |
| `resetProfileIcon()` | ✅ | Clears `ProfileSettings.icon` so the connection screen falls back to the auto-generated name tile |
| `resetStopWatch(id\|name)` | ✅ | Zeroes elapsed; a running watch keeps running |
| `resumeNamedTimer(parent, name)` | ✅ | IDManager.lua |
| `resumeNamedTrigger(parent, name)` | ✅ | IDManager.lua |
| `setButtonState(name, state)` | ✅ | Pressed state on a two-state (push-down) button |
| `sendCmdLine(text)` | ✅ | Set + send the main command bar |
| `setConsoleBufferSize([window,] linesLimit [, batchSize])` | ✅ | Maps to `Console.setMaxLines` |
| `setProfileIcon(path)` | ✅ | Reads the VFS image and inlines it as a `data:` URI into `ProfileSettings.icon` so the picker screen renders it without mounting the profile VFS. `(true, path)` / `(false, errMsg)` via Bridge.lua |
| `setProfileInformation(text)` | ✅ | Stores the profile's free-text description (`ProfileSettings.description`); the optional profile-name overload is ignored (single-profile) |
| `setScript(name, code)` | ✅ | JS-exposed |
| `setStopWatchName(id\|currentName, newName)` | ✅ | Empty name or duplicate name → false |
| `setStopWatchPersistence(id\|name, state)` | ✅ | Persistent watches saved to localStorage and restored on reload; running ones keep counting across reloads (wall-clock `Date.now()`) |
| `setTriggerStayOpen(name, lines)` | ✅ | Extends the named chain head's open window |
| `startStopWatch(id\|name [, resetAndRestart])` | ✅ | Bare numeric id resets+restarts (legacy); name form resumes |
| `stopAllNamedTimers(parent)` | ✅ | IDManager.lua |
| `stopAllNamedTrigger(parent)` | ✅ | IDManager.lua alias of `stopAllNamedTriggers` (the wiki lists the singular name) |
| `stopNamedTimer(parent, name)` | ✅ | IDManager.lua |
| `stopNamedTrigger(parent, name)` | ✅ | IDManager.lua |
| `stopStopWatch(id\|name)` | ✅ | Returns elapsed seconds |
| `tempAlias(pattern, code)` | ✅ | |
| `tempAnsiColorTrigger(fg, bg, code)` | ✅ | ANSI 256-colour-index variant of `tempColorTrigger` (shares the palette-matching engine); any negative index (Mudlet ColorIgnore/ColorDefault) → match any |
| `tempBeginOfLineTrigger(pattern, code)` | ✅ | Literal prefix (`String.prototype.startsWith`), NOT regex `^` — matches Mudlet's `match_begin_of_line_substring` |
| `tempButton(toolbar, name, code, orientation)` | ✅ | Appends a transient ButtonNode under the named toolbar |
| `tempButtonToolbar(name, orientation, location)` | ✅ | `orientation`: 0=horizontal, 1=vertical. `location`: 0=top, 1=bottom, 2=left, 3=right, 4=floating |
| `tempColorTrigger(fg, bg, code)` | ✅ | Matches on ANSI palette indices on the current rendered line (`-1` = any). Non-indexed RGB segments never match a positive index, matching Mudlet's palette-only semantics |
| `tempComplexRegexTrigger(...)` | ✅ | Bridge.lua over the temp regex-trigger primitive. Honours regex + code/fn, **highlight** (`hlFgColor`/`hlBgColor` — colour name / `#rrggbb` / `"r,g,b"`; all occurrences when `matchAll`), **soundFile**, **expireAfter**, and **named triggers** (re-call with an existing name replaces it; `killTrigger(name)` removes it). `multiline`-AND, `filter`, `fireLength`, `lineDelta` and colour-pattern (`fgColor`/`bgColor`) need a permanent trigger (`permRegexTrigger` + editor) and emit a one-time `printDebug` warning when requested |
| `tempExactMatchTrigger(pattern, code)` | ✅ | Full-line exact match |
| `tempKey(modifier, key, code)` | ✅ | |
| `tempLineTrigger(from, count, code)` | ✅ | Position-based: fires on `count` lines starting `from` lines ahead, then self-expires |
| `tempPromptTrigger(code)` | ✅ | Fires on GA/EOR-flagged prompt lines; expirationCount honoured |
| `tempRegexTrigger(pattern, code)` | ✅ | Bridge.lua wraps `__mudix_tempRegexTrigger` |
| `tempTimer(delay, code [, repeat])` | ✅ | One-shot or repeating timer |
| `tempTrigger(pattern, code)` | ✅ | Temporary substring/regex trigger |

mudix-specific extras (not on the wiki): `mudix.windows.write/setTitle/has/focus`, the `mudix.timers.after`/`mudix.aliases.add` Lua-side namespace (alongside the Mudlet API).

---

## Networking Functions

| Function | Status | Notes |
|---|---|---|
| `connectToServer(host, port [, save])` | ✅ | Builds the proxy `?host=&port=` URL the connection screen uses and (re)connects. `save` persists host/port onto the active connection |
| `customHTTP(method, url, data [, headers])` | ✅ | Bridge.lua → `HttpService.customHTTP`; fires `sysCustomHttp*` |
| `deleteHTTP(url [, headers])` | ✅ | Bridge.lua → `HttpService.deleteHTTP` |
| `disconnect()` | ✅ | `MudSession.disconnect` |
| `downloadFile(url, path)` | ✅ | Bridge.lua → `HttpService.downloadFile`, writes to profile VFS |
| `feedTelnet(data)` | ✅ | Injects raw bytes into `MudClient.processIncomingData` (telnet strip → ANSI → triggers → render). mudix feeds the live inbound pipeline (Mudlet only loops back when unconnected) |
| `getConnectionInfo()` | ✅ | Bridge.lua → host, port, connected |
| `getHTTP(url [, headers])` | ✅ | Bridge.lua → `HttpService.getHTTP`; fires `sysGetHttpDone`/`sysGetHttpError` |
| `getIrcChannels()` / `getIrcConnectedHost()` / `getIrcNick()` / `getIrcServer()` | ❌ stub | No IRC client in mudix; bind as warning-emitting no-op stubs (getters return empty table / `""`) |
| `getNetworkLatency()` | ✅ | JS-exposed |
| `openIRC()` / `restartIrc()` / `sendIrc()` / `setIrcChannels()` / `setIrcNick()` / `setIrcServer()` | ❌ stub | No IRC client; bind as warning-emitting no-op stubs |
| `openUrl(url)` | ✅ | `window.open(url, '_blank')`; `file:` prefix routes to the VFS file browser |
| `postHTTP(url, data [, headers])` | ✅ | Bridge.lua → `HttpService.postHTTP` |
| `putHTTP(url, data [, headers])` | ✅ | Bridge.lua → `HttpService.putHTTP` |
| `reconnect()` | ✅ | Disconnect + redial the last-connected URL (`MudSession.lastUrl`, set by every `connect()`); false when nothing dialed yet |
| `sendAll(text1, text2, ...)` | ✅ | Other.lua |
| `sendATCP(msg)` | ✅ | `IAC SB ATCP(200) <payload> IAC SE` via `MudClient.sendRaw` (shared `sendSubnegotiation` helper); false when the socket is closed |
| `sendGMCP(message)` | ✅ | Frames as IAC SB GMCP … |
| `sendMSDP(var, ...)` | ✅ | Frames `IAC SB MSDP MSDP_VAR var [MSDP_VAL val]… IAC SE`. Bridge.lua packs varargs |
| `sendSocket(data)` | ✅ | Literal bytes (no telnet/encoding processing) |
| `sendTelnetChannel102(data)` | ✅ | `IAC SB 102 <data> IAC SE` via `MudClient.sendRaw` (shared `sendSubnegotiation` helper); false when the socket is closed |

mudix-specific extras: `gmcp` table, `msdp` table, `gmcp.<path>` per-key event chain.

---

## String Functions

Standard Lua 5.1 string functions (`string.byte`, `string.char`, `string.find`, `string.format`, `string.gmatch`, `string.gsub`, `string.len`, `string.lower`, `string.match`, `string.rep`, `string.reverse`, `string.sub`, `string.upper`) ship with wasmoon and are listed once below.

| Function | Status | Notes |
|---|---|---|
| `addWordToDictionary(word)` | ❌ stub | No Hunspell in browser; bind as warning-emitting no-op stub |
| `cecho2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `f(str)` | ✅ | StringUtils.lua — `{expr}` interpolation |
| `getDictionaryWordList()` | ❌ stub | Stub returns empty table |
| `hecho2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `removeWordFromDictionary(word)` | ❌ stub | Warning-emitting no-op |
| `spellCheckWord(word, useUser)` | ❌ stub | Stub returns `true` (treat every word as spelled correctly) |
| `spellSuggestWord(word, useUser, n)` | ❌ stub | Stub returns empty table |
| `string.byte` / `string.char` / `string.find` / `string.format` / `string.gmatch` / `string.gsub` / `string.len` / `string.lower` / `string.match` / `string.rep` / `string.reverse` / `string.sub` / `string.upper` | ✅ | Lua 5.1 stdlib (wasmoon) |
| `string.cut(s, maxlen)` | ✅ | StringUtils.lua |
| `string.dump(fn)` | ✅ | Lua 5.1 stdlib |
| `string.enclose(s [, level])` | ✅ | StringUtils.lua (bundled verbatim) |
| `string.ends(s, suffix)` | ✅ | StringUtils.lua |
| `string.findPattern(s, pattern)` | ✅ | StringUtils.lua (bundled verbatim) |
| `string.genNocasePattern(s)` | ✅ | StringUtils.lua |
| `string.gfind(s, pat)` | ✅ | Lua 5.1 alias for `string.gmatch` (wasmoon) |
| `string.patternEscape(s)` | ✅ | StringUtils.lua |
| `string.split(s, sep)` | ✅ | StringUtils.lua |
| `string.starts(s, prefix)` | ✅ | StringUtils.lua |
| `string.title(s)` | ✅ | StringUtils.lua |
| `string.trim(s)` | ✅ | StringUtils.lua |
| `utf8.byte` / `utf8.char` / `utf8.find` / `utf8.gmatch` / `utf8.gsub` / `utf8.len` / `utf8.lower` / `utf8.match` / `utf8.reverse` / `utf8.sub` / `utf8.upper` | ✅ | Bundled `utf8.lua` (Stepets) exposed as the `utf8` global |
| `utf8.patternEscape` / `utf8.title` | ✅ | StringUtils.lua. `patternEscape` escapes Lua-pattern magic chars (function replacement — the bundled `utf8.gsub` drops table-replacement misses); `title` uppercases the first code point |
| `utf8.charpos` / `utf8.escape` / `utf8.fold` / `utf8.insert` / `utf8.ncasecmp` / `utf8.next` / `utf8.remove` / `utf8.width` / `utf8.widthindex` | ✅ | luautf8 (starwing) extensions ported into `utf8.lua` over the bundled Stepets helpers. `fold`/`ncasecmp` case-fold ASCII (no Unicode CaseFolding table); `width`/`widthindex` use Markus Kuhn's wcwidth ranges (combining → 0, East-Asian wide/fullwidth → 2) and accept (but don't tabulate) `ambi_is_double` |

---

## Table Functions

Standard Lua 5.1 table functions (`table.concat`, `table.insert`, `table.maxn`, `table.remove`, `table.sort`) ship with wasmoon.

| Function | Status | Notes |
|---|---|---|
| `spairs(t [, fn])` | ✅ | TableUtils.lua — sorted-key iterator |
| `table.collect(t, fn)` | ✅ | TableUtils.lua |
| `table.complement(t1, t2)` | ✅ | TableUtils.lua |
| `table.concat` | ✅ | Lua 5.1 stdlib |
| `table.contains(t, val)` | ✅ | TableUtils.lua |
| `table.deepcopy(t)` | ✅ | TableUtils.lua |
| `table.insert` | ✅ | Lua 5.1 stdlib |
| `table.intersection(t1, t2)` | ✅ | TableUtils.lua |
| `table.index_of(t, val)` | ✅ | TableUtils.lua |
| `table.is_empty(t)` | ✅ | TableUtils.lua |
| `table.keys(t)` | ✅ | TableUtils.lua |
| `table.load(filename)` | ✅ | Other.lua, uses `dofile`/VFS |
| `table.matches(t, ...)` | ✅ | TableUtils.lua |
| `table.maxn` | ✅ | Lua 5.1 stdlib |
| `table.n_collect(t, fn)` | ✅ | TableUtils.lua |
| `table.n_filter(t, fn)` | ✅ | TableUtils.lua |
| `table.n_flatten(t)` | ✅ | TableUtils.lua |
| `table.n_matches(t, ...)` | ✅ | TableUtils.lua |
| `table.n_union(t1, t2)` | ✅ | TableUtils.lua |
| `table.n_complement(t1, t2)` | ✅ | TableUtils.lua |
| `table.n_intersection(t1, t2)` | ✅ | TableUtils.lua |
| `table.pickle(t)` | ✅ | TableUtils.lua |
| `table.remove` | ✅ | Lua 5.1 stdlib |
| `table.save(filename, t)` | ✅ | Other.lua, uses `io.open`/VFS |
| `table.sort` | ✅ | Lua 5.1 stdlib |
| `table.size(t)` | ✅ | Counts all keys including non-integer |
| `table.unpickle(s)` | ✅ | TableUtils.lua |
| `table.update(t1, t2)` | ✅ | TableUtils.lua |
| `table.union(t1, t2, ...)` | ✅ | TableUtils.lua |

---

## Text to Speech Functions

Implemented via the Web Speech API (`TtsManager`). Mudlet uses ranges `-1..1` for rate/pitch and `0..1` for volume; mudix maps these to Web Speech ranges at speak time.

| Function | Status | Notes |
|---|---|---|
| `ttsClearQueue([index])` | ✅ | Whole queue or the 1-based `index` item (false if out of bounds) |
| `ttsGetCurrentLine()` | ✅ | Maps idle/errored to `(nil, "not speaking any text")` |
| `ttsGetCurrentVoice()` | ✅ | Selected voice name, or engine default |
| `ttsGetPitch()` | ✅ | |
| `ttsGetQueue([index])` | ✅ | 1-based; `index` form returns one item or false |
| `ttsGetRate()` | ✅ | |
| `ttsGetState()` | ✅ | `ttsSpeechReady`/`ttsSpeechStarted`/`ttsSpeechPaused`/`ttsSpeechError`/`ttsUnknownState`, raised as events on transitions |
| `ttsGetVoices()` | ✅ | 1-based array of voice names |
| `ttsGetVolume()` | ✅ | |
| `ttsPause()` | ✅ | |
| `ttsQueue(text [, index])` | ✅ | Inserts at 1-based `index` (default end); raises `ttsSpeechQueued(text, index)` |
| `ttsResume()` | ✅ | |
| `ttsSpeak(text)` | ✅ | Speaks immediately, interrupting current. Strips angle brackets like Mudlet |
| `ttsSetPitch(pitch)` | ✅ | Raises `ttsPitchChanged` |
| `ttsSetRate(rate)` | ✅ | Raises `ttsRateChanged` |
| `ttsSetVolume(vol)` | ✅ | Raises `ttsVolumeChanged` |
| `ttsSetVoiceByIndex(index)` | ✅ | 1-based; returns bool |
| `ttsSetVoiceByName(name)` | ✅ | Returns bool; raises `ttsVoiceChanged` |
| `ttsSkip()` | ✅ | Stops current, advances to next queued |

---

## UI Functions

| Function | Status | Notes |
|---|---|---|
| `addCommandLineMenuEvent(name, event)` | ✅ | Right-click command-line menu hook |
| `addMouseEvent(uniquename, event [, displayName [, tooltip]])` | ✅ | `MouseEventRegistry` (mirrors `Host::mConsoleActions`) on `MudSession`. Adds a custom entry to the main output area's right-click menu (`OutputArea` context menu); clicking raises `event`. False on a duplicate uniqueName |
| `ansi2decho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `ansi2string(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `appendBuffer([window])` | ✅ | Appends the clipboard (from `copy()`) as a new line to the named console |
| `bg([window,] colorname)` | ✅ | Set background color by name |
| `calcFontSize(size[, family]) \| calcFontSize(windowName)` | ✅ | Canvas-2D monospace cell measurement, falls back to App.css `--font-mono` |
| `cecho([window,] text)` | ✅ | `<colorname>text` syntax |
| `cechoLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2ansi(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2decho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2hecho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cecho2html(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `cechoPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `cinsertLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `cinsertPopup([window,] text, cmds, hints)` | ✅ | Pure Lua via GUIUtils.lua |
| `cinsertText([window,] text)` | ✅ | Pure Lua via GUIUtils.lua |
| `clearUserWindow(name)` | ✅ | Alias of `clearWindow` on user windows |
| `clearWindow(name)` | ✅ | Clears panel content |
| `closestColor(r, g, b)` | ✅ | Pure Lua via GUIUtils.lua |
| `copy([window])` | ✅ | Copies the current selection (with formatting) into the session clipboard (Mudlet's host-global `mClipboard`) |
| `copy2decho()` | ✅ | Returns the current selection as decho text |
| `copy2html()` | ✅ | Returns the current selection as HTML |
| `createBuffer(name)` | ✅ | Off-screen text buffer (no panel) — registers a named Console; output stays in history (never opens a panel) and is selectable/copyable. `windowType` reports `"buffer"` |
| `createCommandLine([parent,] name, x, y, w, h)` | ✅ | Absolutely-positioned overlay `<input>` rendered by `CommandLineOverlay` on the named parent viewport (defaults to main). Sibling to `createLabel` / `createMiniConsole` — uses the unified `moveWindow` / `resizeWindow` / `showWindow` / `hideWindow` / `raiseWindow` / `lowerWindow` lookup |
| `createConsole(name, fontSize, charsW, linesH, x, y)` | ✅ | JS-exposed |
| `createGauge(name, x, y, w, h, parent)` | ✅ | Pure Lua via GUIUtils.lua (3× `createLabel` + `setBackgroundColor`) |
| `createLabel(name, x, y, w, h, passthrough)` | ✅ | JS-exposed |
| `createMiniConsole(name, x, y, w, h)` | ✅ | JS-exposed |
| `createScrollBox([parent,] name, x, y, w, h)` | ✅ | Absolutely-positioned scrollable overlay container (`ScrollBoxManager` + `ScrollBoxOverlay`) on the named parent viewport (defaults to main). Other overlay widgets (labels, command lines, nested scroll boxes) nest inside it by passing the box name as their parent; backs `Geyser.ScrollBox`. Routed by the unified `moveWindow`/`resizeWindow`/`showWindow`/`hideWindow`/`raiseWindow`/`lowerWindow` lookups; `windowType` reports `"scrollbox"`. Opaque default background (themed `--bg-input`) mirroring Mudlet's bare `QScrollArea`, so an empty box is visible. Real overflow scrolling: each box wraps its children in a content div sized to their furthest edge (computed by subscribing to the label/cmdline/scrollbox managers for the box), and scrolls a given axis only when its children overflow it |
| `creplace([window,] text)` | ✅ | Pure Lua via GUIUtils.lua |
| `creplaceLine([window,] text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho([window,] text)` | ✅ | `<r,g,b>text` syntax |
| `decho2ansi(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2cecho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2hecho(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `decho2html(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `dechoLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `dechoPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `dinsertLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `dinsertPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `deleteCommandLine(name)` | ✅ | Destroys an overlay cmd line; fires `sysCommandLineDeleted(name)` and frees the bound action callback chunk |
| `deleteLabel(name)` | ✅ | Bridge.lua → `__deleteLabel` |
| `deleteLine()` | ✅ | Removes last output element |
| `deleteMiniConsole(name)` | ✅ | Rejects non-miniconsole targets (CONSOLE-only, matches Mudlet) |
| `deleteMultiline(text)` | ✅ | Multi-line deletion (GUIUtils.lua) |
| `deleteScrollBox(name)` | ✅ | Destroys a scroll box created by `createScrollBox`; fires `sysScrollBoxDeleted(name)` on success |
| `deselect([window])` | ✅ | JS-exposed |
| `disableClickthrough(name)` | ✅ | JS-exposed |
| `disableCommandLine(name)` | ✅ | Overlay cmd lines disable the input (greyed); per-userwindow cmd lines hide the docked input; main bar is a no-op |
| `disableHorizontalScrollBar(name)` | ✅ | JS-exposed |
| `disableScrollBar(name)` | ✅ | JS-exposed |
| `disableScrolling(name)` | ✅ | JS-exposed |
| `dreplace([window,] text)` | ✅ | Pure Lua via GUIUtils.lua |
| `dreplaceLine([window,] text)` | ✅ | Pure Lua via GUIUtils.lua |
| `echoLink([window,] text, cmd, hint)` | ✅ | Bridge.lua maps function `cmd` to a callback id |
| `echoUserWindow(name, text)` | ✅ | Alias for `mudix.windows.write` |
| `echoPopup([window,] text, cmds, hints)` | ✅ | Bridge.lua flattens cmds/hints tables |
| `enableClickthrough(name)` | ✅ | JS-exposed |
| `enableCommandLine(name)` | ✅ | Overlay cmd lines re-enable a disabled input; per-userwindow cmd lines show the docked input; main bar is a no-op |
| `enableHorizontalScrollBar(name)` | ✅ | JS-exposed |
| `enableScrollBar(name)` | ✅ | JS-exposed |
| `enableScrolling(name)` | ✅ | JS-exposed |
| `fg([window,] colorname)` | ✅ | Set foreground color by name |
| `getAvailableFonts()` | ✅ | `{[family]=true}` set merging web-safe families, FontFaceSet registrations, the profile font, and Local Font Access results |
| `getBackgroundColor([window])` | ✅ | JS-exposed |
| `getBgColor([window])` | ✅ | Bridge.lua — color at selection start; distinct from window-background `getBackgroundColor` |
| `getBorderBottom()` / `getBorderTop()` / `getBorderLeft()` / `getBorderRight()` | ✅ | JS-exposed |
| `getBorderSizes()` | ✅ | JS-exposed |
| `getClipboardText()` | ✅ | Returns a session text-clipboard mirror synchronously (Mudlet's signature); the OS clipboard can only be read async in the browser, so it kicks off a best-effort `navigator.clipboard.readText` refresh for the next call. Distinct from `copy`/`paste`'s rich-text buffer |
| `getColorWildcard()` | ✅ | Returns the captured colour wildcard from the current trigger |
| `getColumnCount([window])` | ✅ | JS-exposed |
| `getColumnNumber([window])` | ✅ | JS-exposed |
| `getCurrentLine([window])` | ✅ | Bridge.lua wraps `__getCurrentLine` |
| `getFgColor([window])` | ✅ | Bridge.lua — color at selection start; falls back to profile default |
| `getFont([window])` | ✅ | Bridge.lua → `__getFont` |
| `getFontSize([window])` | ✅ | Bridge.lua → `__getFontSize` |
| `getHTMLformat(text)` | ✅ | Mudlet-format → HTML serialisation |
| `getImageSize(path)` | ✅ | Synchronous — reads dimensions straight out of the VFS file's header (`imageSize.ts` parses PNG/GIF/JPEG/BMP/WebP), no `Image.onload` decode needed. Returns `width, height` or nil; Bridge.lua unpacks the 0-indexed `[w,h]` array |
| `getLabelFormat(name)` | ✅ | GUIUtils.lua |
| `getLabelSizeHint(name)` | ✅ | Bridge.lua → `width, height`. Browser analogue of Qt sizeHint (rendered content extent) |
| `getLabelStyleSheet(name)` | ✅ | Reads the CSS last set via `setLabelStyleSheet` |
| `getLastLineNumber([window])` | ✅ | JS-exposed |
| `getLineCount([window])` | ✅ | JS-exposed |
| `getLines([window,] from, to)` | ✅ | Bridge.lua wraps `__getLines` |
| `getLineNumber([window])` | ✅ | JS-exposed |
| `getMainConsoleWidth()` | ✅ | Monospace cell width × (wrap columns + 1) |
| `getMouseEvents()` | ✅ | `{ [uniqueName] = { ["event name"], ["display name"], ["tooltip text"] } }` from the `MouseEventRegistry` |
| `getMousePosition()` | ✅ | Bridge.lua — last-seen cursor position in main viewport coords |
| `getProfileTabNumber(name)` | ✅ | No tab UI in mudix; single-profile, so always returns 1 |
| `getMainWindowSize()` | ✅ | Returns `window.innerWidth, window.innerHeight` |
| `getRowCount([window])` | ✅ | JS-exposed |
| `getScroll([window])` | ✅ | Returns the scroll position (top-most visible line) |
| `getSelection([window])` | ✅ | Bridge.lua wraps `__getSelection` |
| `getTextFormat([window])` | ✅ | Bridge.lua → documented attribute table |
| `getUserWindowSize(name)` | ✅ | Bridge.lua → `__getUserWindowSize` |
| `getWindowWrap(name)` | ✅ | → wrap columns (0 unset). "main" reads the profile `outputWrapAt`; a named window reads the `WindowManager` hint. -1 when the window is missing. Used by `Geyser.MiniConsole:getWindowWrap` |
| `handleWindowResizeEvent()` | ✅ | Fires the resize listener chain (no-op shim that's part of the public API) |
| `hasFocus([window])` | ✅ | `document.activeElement` check. No name = command bar; a name targets the registered overlay element |
| `hecho([window,] text)` | ✅ | `#RRGGBBtext` syntax |
| `hecho2ansi(text)` / `hecho2cecho(text)` / `hecho2decho(text)` / `hecho2html(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hechoLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `hechoPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `hideGauge(name)` | ✅ | Pure Lua via GUIUtils.lua |
| `hinsertLink([window,] text, cmd, hint)` | ✅ | Pure Lua via GUIUtils.lua |
| `hinsertPopup(...)` | ✅ | Pure Lua via GUIUtils.lua |
| `hreplaceLine([window,] text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hreplace([window,] text)` | ✅ | Pure Lua via GUIUtils.lua |
| `hideToolBar(name)` | ✅ | Disables the toolbar group; false when no toolbar of that name exists |
| `hideWindow(name)` | ✅ | JS-exposed |
| `insertLink([window,] text, cmd, hint)` | ✅ | Bridge.lua maps function `cmd` to a callback id |
| `insertPopup([window,] text, cmds, hints)` | ✅ | Bridge.lua flattens cmds/hints tables |
| `insertText([window,] text)` | ✅ | JS-exposed |
| `ioprint(...)` | ✅ | Mudlet's print-to-stdout helper; routes to the devtools `console.log` in the browser |
| `isAnsiBgColor(idx)` / `isAnsiFgColor(idx)` | ✅ | True when the fg/bg color at the current selection start equals ANSI/xterm index `idx` (0-7 normal, 8-15 bright, 16-255 xterm-256). mudix stores rendered RGB, so it compares against the palette entry's RGB; false with no selection. Used by Other.lua |
| `loadWindowLayout()` | ✅ | Re-applies the saved snapshot — re-positions live windows and reopens saved-visible windows |
| `lowerWindow(name)` | ✅ | JS-exposed |
| `moveCursor([window,] x, y)` | ✅ | JS-exposed |
| `moveCursorDown([window])` / `moveCursorUp([window])` | ✅ | GUIUtils.lua |
| `moveCursorEnd([window])` | ✅ | JS-exposed |
| `moveGauge(name, x, y)` | ✅ | Pure Lua via GUIUtils.lua |
| `moveWindow(name, x, y)` | ✅ | JS-exposed |
| `openUserWindow(name [, …])` | ✅ | Opens (or focuses) a dockable user-window panel |
| `paste([window])` | ✅ | Pastes the clipboard at the cursor; appends at end when on the last line |
| `pauseMovie(name)` | 🚧 | No QMovie equivalent in browser |
| `prefix(text)` | ✅ | Pure Lua via GUIUtils.lua (moveCursor + insertText) |
| `print(...)` | ✅ | Alias for echo |
| `raiseWindow(name)` | ✅ | CSS `z-index` on labels via `raiseLabel`/`lowerLabel` |
| `removeCommandLineMenuEvent(name, event)` | ✅ | Pairs with `addCommandLineMenuEvent` |
| `removeMouseEvent(uniquename)` | ✅ | Removes a `MouseEventRegistry` entry; pairs with `addMouseEvent` |
| `replace(text)` | ✅ | JS-exposed |
| `replaceAll(what, with)` | ✅ | Pure Lua sweep over the current line buffer |
| `replaceLine(text)` | ✅ | Pure Lua via GUIUtils.lua (selectCurrentLine + replace) |
| `replaceWildcard(n, text)` | ✅ | Replace the n-th capture group in the current line |
| `resetCmdLineAction([name])` | ✅ | Routes to overlay cmd lines, per-userwindow cmd lines, or the main bar |
| `resetBackgroundImage(name)` | ✅ | Clears the label's (or window's) background image |
| `resetFormat([window])` | ✅ | Reset all formatting |
| `resetLabelCursor(name)` | ✅ | JS-exposed |
| `resetLabelToolTip(name)` | ✅ | JS-exposed |
| `resetMapWindowTitle()` | ✅ | Pairs with `setMapWindowTitle` |
| `resetUserWindowTitle(name)` | ✅ | Pairs with `setUserWindowTitle` |
| `resizeWindow(name, w, h)` | ✅ | JS-exposed |
| `saveWindowLayout()` | ✅ | Snapshots window hints + dock extents into `connectionLayoutSnapshots` |
| `scaleMovie(name, factor)` | 🚧 | No QMovie equivalent |
| `selectCaptureGroup(n)` | ✅ | JS-exposed |
| `selectCmdLineText([name])` | ✅ | Selects all text in the targeted overlay cmd line or the main bar (per-userwindow cmd lines accept the name for parity) |
| `selectCurrentLine([window])` | ✅ | JS-exposed |
| `selectSection([window,] col, len)` | ✅ | JS-exposed |
| `selectString([window,] text, n)` | ✅ | JS-exposed |
| `setAppStyleSheet(css)` | ✅ | Installs/replaces a CSS block in `document.head`; raises `sysAppStyleSheetChange` |
| `setBackgroundColor([window,] r,g,b,a)` | ✅ | JS-exposed |
| `setBackgroundImage(name, path)` | ✅ | Pure Lua via GUIUtils.lua → `setLabelStyleSheet` |
| `setBgColor([window,] r, g, b)` | ✅ | JS-exposed |
| `setBold([window,] bool)` | ✅ | JS-exposed |
| `setBorderBottom(px)` / `setBorderTop(px)` / `setBorderLeft(px)` / `setBorderRight(px)` | ✅ | JS-exposed |
| `setBorderColor(r,g,b)` | ✅ | Also `resetBorderColor` |
| `setBorderSizes(...)` | ✅ | Bulk setter via the four side-specific routines |
| `setFgColor([window,] r, g, b)` | ✅ | JS-exposed |
| `setButtonStyleSheet(name, css)` | ✅ | Raw QSS → inline React style. Pseudo-state selectors (`:hover`/`:pressed`) drop through |
| `setClipboardText(text)` | ✅ | Updates the session text-clipboard mirror (authoritative) and best-effort writes to `navigator.clipboard` (may be gesture/permission gated). Always true |
| `setCmdLineAction([name,] fn)` | ✅ | Routes to overlay cmd lines, per-userwindow cmd lines, or the main bar. Prior callback freed on rebind |
| `setCmdLineStyleSheet([name,] css)` | ✅ | Translates QSS through `cmdLineQssToScopedCss` for overlay and per-userwindow cmd lines; main bar has no QSS hook so returns true as a no-op |
| `setFont([window,] font)` | ✅ | Bridge.lua → `__setFont` |
| `setFontSize([window,] size)` | ✅ | Bridge.lua → `__setFontSize` |
| `setGauge(name, current, max [, text])` | ✅ | Pure Lua via GUIUtils.lua |
| `setGaugeStyleSheet(name, css [, textcss])` | ✅ | Pure Lua via GUIUtils.lua → `setLabelStyleSheet` |
| `setGaugeText(name, text [, r, g, b])` | ✅ | Pure Lua via GUIUtils.lua |
| `setHexBgColor([window,] hex)` | ✅ | Pure Lua via GUIUtils.lua → setBgColor |
| `setHexFgColor([window,] hex)` | ✅ | Pure Lua via GUIUtils.lua → setFgColor |
| `setItalics([window,] bool)` | ✅ | JS-exposed |
| `setLabelToolTip(name, text, delay)` | ✅ | JS-exposed |
| `setLabelClickCallback(name, fn)` | ✅ | Bridge.lua + JS callback registry |
| `setLabelDoubleClickCallback(name, fn)` | ✅ | Bridge.lua |
| `setLabelMoveCallback(name, fn)` | ✅ | Bridge.lua |
| `setLabelOnEnter(name, fn)` | ✅ | Bridge.lua |
| `setLabelOnLeave(name, fn)` | ✅ | Bridge.lua |
| `setLabelReleaseCallback(name, fn)` | ✅ | Bridge.lua |
| `setLabelStyleSheet(name, css)` | ✅ | JS-exposed |
| `setLabelCursor(name, shape)` | ✅ | JS-exposed |
| `setLabelCustomCursor(name, path[, hotX, hotY])` | ✅ | CSS `cursor: url(...) hotX hotY, auto`; path resolved through the VFS-aware rewriter |
| `setLabelWheelCallback(name, fn)` | ✅ | Bridge.lua |
| `setLink([window,] cmd, hint)` | ✅ | Bridge.lua maps function `cmd` to a callback id |
| `setMainWindowSize(w, h)` | 🚧 | The main window IS the browser viewport |
| `setMapWindowTitle(title)` | ✅ | Sets the dockable map panel (`id "map"`) tab title via `WindowManager.setTitle`; empty title resets to default. False when the map widget is closed. Unblocks `resetMapWindowTitle` (GUIUtils) and `Geyser.Mapper` |
| `setMiniConsoleFontSize(name, size)` | ✅ | Bridge.lua; rejects non-miniconsole targets (CONSOLE-only, matches Mudlet) |
| `setMovie(name, path)` / `setMovieFrame(name, n)` / `setMovieSpeed(name, factor)` / `startMovie(name)` | 🚧 | No QMovie equivalent — could be replaced by `<img>` with animated GIFs |
| `setOverline([window,] bool)` | ✅ | FormatState `overline` channel (ANSI SGR 53/55) → CSS `text-decoration: overline`; selection-aware like the other style setters. `setTextFormat`/`getTextFormat` carry it too |
| `setPopup([window,] cmds, hints)` | ✅ | Right-click popup on the current selection (preserves formatting, like `setLink`) |
| `setProfileStyleSheet(css)` | ✅ | Installs/replaces a profile-wide `<style>` block in `document.head` (keyed apart from `setAppStyleSheet`); raises `sysAppStyleSheetChange` with tag `"profile"` |
| `setReverse([window,] bool)` | ✅ | Sets `FormatState.inverse` on pen + selection (renderer swaps fg/bg) |
| `setStrikeOut([window,] bool)` | ✅ | JS-exposed |
| `setTextFormat([window,] ...)` | ✅ | `r1,g1,b1,r2,g2,b2,bold,underline,italics[,strikeout,overline,reverse,blink]` |
| `setUnderline([window,] bool)` | ✅ | JS-exposed |
| `setUserWindowTitle(name, title)` | ✅ | JS-exposed |
| `setUserWindowStyleSheet(name, css)` | ✅ | JS-exposed |
| `setWindow(...)` | 🚧 | Geyser/window parent reparenting |
| `setWindowWrap(name, col)` | ✅ | JS-exposed |
| `setWindowWrapHangingIndent(name, n)` | ✅ | Indent (chars) of wrapped continuation lines. Stored on `ProfileSettings.outputWrapHangingIndent` ("main") or the `WindowManager` hint (named windows); `StickyOutputPanel` applies it as the `--wrap-hanging` CSS var (`.output-msg-content` `padding-left`). 0 clears |
| `setWindowWrapIndent(name, n)` | ✅ | Indent (chars) of newline-started lines. Stored on `ProfileSettings.outputWrapIndent` ("main") or the `WindowManager` hint; applied via the `--wrap-indent` CSS var (`text-indent`, relative to the hanging indent). 0 clears |
| `showCaptureGroups()` | ✅ | Pure Lua via DebugTools.lua (uses `matches`) |
| `showColors([columns])` | ✅ | Pure Lua via GUIUtils.lua |
| `showGauge(name)` | ✅ | Pure Lua via GUIUtils.lua |
| `showMultimatches()` | ✅ | Pure Lua via DebugTools.lua |
| `showToolBar(name)` | ✅ | Flips a toolbar group's `enabled` flag; false when no toolbar of that name exists |
| `showWindow(name)` | ✅ | JS-exposed |
| `suffix(text)` | ✅ | Pure Lua via GUIUtils.lua |
| `setCommandBackgroundColor([window,] r,g,b[,a])` | ✅ | Patches the `inputBackground` profile field. Main bar only |
| `setCommandForegroundColor([window,] r,g,b[,a])` | ✅ | Patches the `inputForeground` profile field. Main bar only |
| `scrollDown([window,] lines)` | ✅ | Pure Lua via GUIUtils.lua |
| `scrollUp([window,] lines)` | ✅ | Pure Lua via GUIUtils.lua |
| `scrollTo([window,] line)` | ✅ | Jumps the scroll position |
| `windowType(name)` | ✅ | Bridge.lua → `__windowType` |
| `wrapLine([window,] linenum)` | ✅ | Re-renders the line buffer (0-indexed) so embedded `\n` is interpreted; mudix renders with `white-space: pre-wrap` |

mudix-specific extras: `color_table`, `addCmdLineSuggestion`/`removeCmdLineSuggestion`/`clearCmdLineSuggestions` Tab-completion hooks against the main bar, `mudix.windows.*`.

---

## Discord Functions

All Discord Rich Presence functions require the Discord SDK and have no real implementation in a browser MUD client. They should be bound as **warning-emitting no-op stubs** (getters return `nil`, setters/resets are no-ops) so packages that touch Discord on load don't blow up.

| Function | Status |
|---|---|
| `getDiscordDetail` / `setDiscordDetail` | ❌ stub |
| `getDiscordLargeIcon` / `setDiscordLargeIcon` | ❌ stub |
| `getDiscordLargeIconText` / `setDiscordLargeIconText` | ❌ stub |
| `getDiscordSmallIcon` / `setDiscordSmallIcon` | ❌ stub |
| `getDiscordSmallIconText` / `setDiscordSmallIconText` | ❌ stub |
| `getDiscordParty` / `setDiscordParty` | ❌ stub |
| `getDiscordState` / `setDiscordState` | ❌ stub |
| `getDiscordTimeStamps` / `setDiscordElapsedStartTime` / `setDiscordRemainingEndTime` | ❌ stub |
| `resetDiscordData` | ❌ stub |
| `setDiscordApplicationID` / `setDiscordGame` / `setDiscordGameUrl` | ❌ stub |
| `usingMudletsDiscordID` | ❌ stub |

---

## System Events (fired to Lua by the client)

Reconciled against the authoritative [Mudlet Event Engine](https://wiki.mudlet.org/w/Manual:Event_Engine) list. Arg lists exclude the implicit leading event-name argument.

**Lifecycle / connection**

| Event | Status | Notes |
|---|---|---|
| `sysLoadEvent` | ✅ | After the initial script load |
| `sysExitEvent` | ✅ | Fired once at `ScriptingEngine.destroy()` (connection switch/unmount) or on `window` `beforeunload`, whichever comes first |
| `sysConnectionEvent` | ✅ | On connect; mudix also fires native `connect` |
| `sysDisconnectionEvent` | ✅ | On disconnect |
| `sysProfileFocusChangeEvent` | ✅ | On `document.visibilitychange` — arg: isFocused |

**Input / send**

| Event | Status | Notes |
|---|---|---|
| `sysDataSendRequest` | ✅ | Before each send; handler may call `denyCurrentSend()` — arg: text |

**Packages / modules**

| Event | Status | Notes |
|---|---|---|
| `sysInstall` / `sysUninstall` | ✅ | After/before any package/module install or uninstall — arg: name |
| `sysInstallPackage` / `sysUninstallPackage` | ✅ | args: name, fileName / name |
| `sysInstallModule` / `sysUninstallModule` | ✅ | args: name, fileName / name |
| `sysLuaInstallModule` / `sysLuaUninstallModule` | ✅ | Fired by the Lua `installModule`/`uninstallModule` paths |
| `sysSyncInstallModule` / `sysSyncUninstallModule` | ✅ | Sync-flagged modules; single-profile, no sibling propagation |

**HTTP / download**

| Event | Status | Notes |
|---|---|---|
| `sysGetHttpDone` / `sysGetHttpError` | ✅ | `getHTTP` — done: url, body · error: error, url |
| `sysPostHttpDone` / `sysPostHttpError` | ✅ | `postHTTP` |
| `sysPutHttpDone` / `sysPutHttpError` | ✅ | `putHTTP` |
| `sysDeleteHttpDone` / `sysDeleteHttpError` | ✅ | `deleteHTTP` |
| `sysCustomHttpDone` / `sysCustomHttpError` | ✅ | `customHTTP` — extra arg: HTTP method |
| `sysDownloadDone` / `sysDownloadError` / `sysDownloadFileProgress` | ✅ | `downloadFile` |
| `sysUnzipDone` / `sysUnzipError` | ✅ | `unzipAsync` |

**Speedwalk** (pure Lua — bundled `Other.lua`)

| Event | Status |
|---|---|
| `sysSpeedwalkStarted` / `sysSpeedwalkPaused` / `sysSpeedwalkResumed` / `sysSpeedwalkStopped` / `sysSpeedwalkFinished` | ✅ |

**Mapper**

| Event | Status | Notes |
|---|---|---|
| `mapOpenEvent` | ✅ | Mapper opened |
| `mapModeChangeEvent` | ✅ | View↔edit transitions (`setMapMode`/`getMapMode`) — arg: "viewing"/"editing" |
| `sysManualLocationSetEvent` | ✅ | `MapPanel`'s right-click "Set player location" — arg: roomID |
| `sysMapAreaChanged` | ✅ | Whenever the displayed area changes — args: newAreaID, prevAreaID (-1 on initial transition) |
| `sysMapDownloadEvent` | 🚧 | No MMP map-protocol support (mudix uses binary maps + `downloadFile`) |
| `sysMapWindowMousePressEvent` | ✅ | args: button (1=left, 2=right, 3=middle), x, y |

**Windows / UI elements**

| Event | Status | Notes |
|---|---|---|
| `sysWindowResizeEvent` | ✅ | Main output resize — args: width, height |
| `sysUserWindowResizeEvent` | ✅ | User-window / miniconsole resize — args: width, height, name |
| `sysConsoleSizeChanged` | ✅ | Char-grid change. Cols come from the wrap setting (falling back to `floor(width / fontSize*0.6)`); rows from `floor(height / lineHeight)`. Also force-fires on `setWindowWrap` — args: name, columns, rows |
| `sysWindowOverflowEvent` | ✅ | Non-scrolling console (`scrollState.scrollingEnabled === false`) when `scrollHeight > clientHeight`; overflowLines = `ceil(overflowPx / lineHeight)` — args: name, overflowLines |
| `sysBufferShrinkEvent` | ✅ | Whenever scrollback cap drops one or more lines (one event per evict batch) — args: name, linesRemoved |
| `sysWindowMousePressEvent` / `sysWindowMouseReleaseEvent` | ✅ | Mouse press/release. Button is Mudlet-numbered (1=left, 2=right, 3=middle, 4=back, 5=forward, 0=other); x/y are pixels relative to the window — args: button, x, y, name |
| `sysLabelDeleted` | ✅ | On successful `deleteLabel` — arg: name |
| `sysMiniConsoleDeleted` | ✅ | On successful `deleteMiniConsole` — arg: name |
| `sysCommandLineDeleted` | ✅ | On successful `deleteCommandLine` — arg: name |
| `sysScrollBoxDeleted` | ✅ | On successful `deleteScrollBox` — arg: name |

**Protocol / telnet**

| Event | Status | Notes |
|---|---|---|
| `sysProtocolEnabled` | ✅ | Fired `"GMCP"` on GMCP negotiation; bundled `GMCP.lua` re-subscribes its modules here. Also fires `"MSDP"` |
| `sysProtocolDisabled` | ✅ | On disconnect when GMCP was active |
| `sysTelnetEvent` | ✅ | For any IAC WILL/WONT/DO/DONT/SB whose option byte isn't natively handled. `type` mirrors Mudlet's int mapping (1=WILL, 2=WONT, 3=DO, 4=DONT, 5=SB) — args: type, option, message |

**Drag & drop**

| Event | Status | Notes |
|---|---|---|
| `sysDropEvent` | ✅ | When a real File is dropped on a window. `path` falls back to the file's `name` since browsers only expose a real path on Electron-flavoured drops — args: filepath, suffix, x, y, name |
| `sysDropUrlEvent` | ✅ | When a textual URL is dropped — args: url, schema, x, y, name |

**Media / misc**

| Event | Status | Notes |
|---|---|---|
| `sysAppStyleSheetChange` | ✅ | `setAppStyleSheet` — args: css, tag |
| `sysPathChanged` | ✅ | VFS mutation of a watched path — arg: path |
| `sysMediaFinished` | ✅ | Sound/music/video source ended or stopped — args: name, path |
| `sysSettingChanged` | ✅ | Per-connection profile-settings mutation. One event per changed field — args: setting, newValue (`undefined` when unset) |
| `sysSoundFinished` | ✅ | Pre-4.15 name, superseded by `sysMediaFinished`. Fired as a compat alias alongside it from the `SoundManager` finished path — args: name, path |
| `sysIrcMessage` | ❌ | No IRC client in mudix; nothing fires it (no stub needed — events don't break callers when never raised) |

> **Not Mudlet events** — do not implement under these names: `sysConnect` / `sysDisconnect` / `sysGmcpMessage` (Mudlet uses `sysConnectionEvent` / `sysDisconnectionEvent` and the `gmcp.<path>` event chain), `sysUserWindowCreated` / `sysUserWindowClosed`, `sysMapperLocationChanged`.
>
> **mudix-specific events** (no Mudlet equivalent): `output` (per output line), `gmcp.<path>` chain (✅, the real GMCP mechanism — args: eventName, fullKey), `sysMapLoadEvent` (✅, after a binary map ingest), `sysSaveProfileError` (✅), `sysReadModuleEvent` / `sysSyncOnModule` (✅, module-sync internals).

---

## Geyser OOP Framework

Pure Lua on top of the overlay primitive API. No additional JS required.

| Class | Status | Notes |
|---|---|---|
| `Geyser.Container` | ✅ | Pure layout, no missing deps |
| `Geyser.Label` | ✅ | Bundled; `getLabelFormat` resolves now that `getLabelStyleSheet` is implemented |
| `Geyser.MiniConsole` | ✅ | Bundled |
| `Geyser.Gauge` | ✅ | Bundled; wraps GUIUtils `createGauge`/`setGauge` |
| `Geyser.HBox` / `Geyser.VBox` | ✅ | Bundled |
| `Geyser.CommandLine` | ✅ | Bundled; the underlying `createCommandLine` overlay primitive is now wired |
| `Geyser.UserWindow` | ✅ | Bundled; uses `openUserWindow` |
| `Geyser.ScrollBox` | ✅ | Bundled; the underlying `createScrollBox`/`deleteScrollBox` overlay primitives are now wired (see UI Functions) |

---

## Not Applicable

These features have no real implementation in mudix, but to keep imported Mudlet scripts/packages portable they are **still bound as warning-emitting no-op stubs** (see the legend). Stubs log once per call site and return a sensible default — see the per-section notes above for the exact return value of each stub.

| Feature | Reason |
|---|---|
| Discord Rich Presence (`getDiscord*` / `setDiscord*`) | Requires Discord SDK |
| IRC client (`openIRC`, `sendIrc`, `*IrcChannels`, `*IrcNick`, `*IrcServer`, `restartIrc`, `getIrcConnectedHost`) | Separate external service |
| Multi-profile management (`loadProfile`, `getProfiles`, `raiseGlobalEvent`) | Single-connection web app |
| `spawn(...)` | No subprocess in the browser |
| Spell-check API (`spellCheckWord`, `spellSuggestWord`, `addWordToDictionary`, `removeWordFromDictionary`, `getDictionaryWordList`) | No Hunspell in browser |
