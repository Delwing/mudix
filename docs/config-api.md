# `setConfig` / `getConfig` Support

Mudlet's `setConfig(key, value)` / `getConfig(key)` are a flat key→value
preferences bag. mudix implements them as a **config registry** in
`ScriptingAPI` (`getConfig` / `setConfig`), with the base globals bound in
`LuaRuntime.ts` and the table-form / no-arg-dump variants layered on top by
bundled `Other.lua`.

## How it's wired

```
Lua: setConfig("enableMSDP", true) / getConfig("enableMSDP")
  → Other.lua wrappers (table form, no-arg "dump all")     src/scripting/lua/mudlet-lua/Other.lua
    → base globals  setConfig / getConfig                   src/scripting/lua/LuaRuntime.ts
      → ScriptingAPI.setConfig / .getConfig (registry)      src/scripting/ScriptingAPI.ts
        → ProfileSettings field  (protocols / mapper / autoClearInput)
        → MudSession.echoSentText (live)
        → ProfileSettings.config bag  (persist-only keys)
```

- **Base globals must be bound before the bundles load.** `Other.lua` captures
  `oldsetConfig = setConfig` / `oldgetConfig = getConfig` and wraps them; if the
  base global is nil the wrapper calls nil and throws. The binding block in
  `LuaRuntime.bootstrap` runs before the `doString`/`exec` of `LuaGlobal.lua`,
  so ordering holds.
- **Unknown key** → `getConfig` returns `nil`, `setConfig` returns `false`
  (matches Mudlet — no error).
- **Read-only key** → `setConfig` returns `false`.
- The no-arg `getConfig()` "dump all" and the table forms
  (`getConfig{...}` / `setConfig{...}`) are handled entirely in `Other.lua`,
  which calls the per-key base function once per entry — so the registry only
  ever deals with a single key.

## Key groups

### 1. Structured — routed to a real `ProfileSettings` field

These stay in sync with the Settings UI because they read/write the same field
the UI does. Protocol changes take effect on the **next connect** (same as
Mudlet); the rest are live.

| Config key | Backing field | Notes |
|---|---|---|
| `enableGMCP` | `protocols.gmcp` | next connect |
| `enableMSDP` | `protocols.msdp` | next connect |
| `enableMSP` | `protocols.msp` | next connect |
| `enableMSSP` | `protocols.mssp` | next connect |
| `enableMTTS` | `protocols.mtts` | next connect |
| `enableMXP` | `protocols.mxp` | next connect |
| `enableMNES` | `protocols.mnes` | next connect |
| `specialForceMxpNegotiationOff` | `!protocols.mxp` | inverse flag |
| `specialForceCharsetNegotiationOff` | `!protocols.charset` | inverse flag |
| `forceNewEnvironNegotiationOff` | `!protocols.mnes` | inverse flag |
| `autoClearInputLine` | `autoClearInput` | live |
| `mapRoomSize` | `mapper.roomSize` | positive number only |
| `mapExitSize` | `mapper.lineWidth` | positive number only |
| `mapRoundRooms` | `mapper.roomShape` | `true`→`roundedRectangle`, else `rectangle` |
| `mapShowRoomBorders` | `mapper.borders` | |
| `mapShowGrid` | `mapper.gridEnabled` | |
| `mapInfoColor` | `config.mapInfoColor` (`{r,g,b,a}`) | map-info widget **background** colour; `{r,g,b[,a]}` table, alpha defaults to 255. `MapPanel` paints `.map-info` with it; default is Mudlet's `{150,150,150,120}`. The Lua↔JS boundary marshals the table as an `"r,g,b,a"` string (Bridge.lua). |

### 2. Live — applied immediately to the session

| Config key | Effect |
|---|---|
| `showSentText` | Sets `MudSession.echoSentText`; when `false`, `echoCommand` suppresses the local echo of sent commands. Persisted to the `config` bag and re-applied on profile load (constructor of `ScriptingAPI`). |

### 3. Persist-only — round-trips but **not yet enforced**

Stored in the `ProfileSettings.config` bag (`CONFIG_PERSIST_ONLY` in
`ScriptingAPI.ts`) with type + enum validation, so `get`/`set` round-trip
faithfully and first reads return a Mudlet-ish default — but mudix does **not
act on them yet**. Each needs a real feature behind it (see "Not implemented"
below). String keys with an `enum` reject out-of-range writes (`setConfig`
returns `false`).

`advertiseScreenReader`, `ambiguousEAsianWidthCharacters` (`auto`/`wide`/`narrow`),
`announceIncomingText`, `askTlsAvailable`, `blankLinesBehaviour` (`show`/`hide`),
`caretShortcut` (`none`/`tab`/`ctrltab`/`f6`), `commandLineHistorySaveSize`,
`compactInputLine`, `controlCharacterHandling` (`asis`/`oem`/`picture`),
`editorAutoComplete`, `enableBlinkText`, `enableClosedCaption`, `f3SearchEnabled`,
`fixUnnecessaryLinebreaks`, `inputLineStrictUnixEndings`, `logInHTML`,
`mapperPanelVisible`, `muteMediaAPI`, `muteMediaGame`,
`promptForMXPProcessorOn`, `promptForVersionInTTYPE`, `show3dMapView`,
`showRoomIdsOnMap`, `showTabConnectionIndicators`, `showUpperLowerLevels`,
`specialForceCompressionOff`, `specialForceGAOff`, `versionInTTYPE`.

### 4. Read-only

`setConfig` returns `false`; `getConfig` returns a synthetic value.

| Config key | `getConfig` returns |
|---|---|
| `logDirectory` | `/profiles/<connectionId>/log` (mudix logs to IndexedDB, not a real folder) |
| `specialForceMXPProcessorOn` | stored bool or `false` |

## Value coercion

- **Booleans** (`configBool`): real booleans pass through; the strings
  `false`/`0`/`no`/`off` (any case) read as `false`; any other non-nil value is
  truthy. Matches how Lua scripts pass flags.
- **Numbers**: `Number(value)`; mapper sizes additionally require finite `> 0`.
- **Enums**: `String(value)` validated against the allowed set; an invalid value
  is rejected (`setConfig` → `false`, no write).

## Not implemented (persist-only keys that need a real feature)

These round-trip through `get`/`set` but have no behavior yet. Promote them from
group 3 to group 1/2 as the underlying feature lands:

- **Accessibility:** `advertiseScreenReader`, `announceIncomingText`,
  `enableClosedCaption`, `caretShortcut` (no caret-browse mode).
- **Rendering:** `enableBlinkText` (ANSI blink not rendered),
  `controlCharacterHandling`, `ambiguousEAsianWidthCharacters`,
  `blankLinesBehaviour` (no blank-line suppression).
- **Input line / editor:** `compactInputLine`, `inputLineStrictUnixEndings`,
  `commandLineHistorySaveSize`, `editorAutoComplete`, `f3SearchEnabled`,
  `fixUnnecessaryLinebreaks`.
- **Telnet edge switches:** `askTlsAvailable`, `specialForceCompressionOff`
  (MCCP kill-switch), `specialForceGAOff`, `versionInTTYPE`,
  `promptForVersionInTTYPE`, `promptForMXPProcessorOn`.
- **Map:** `show3dMapView` (no 3D renderer), `showRoomIdsOnMap`,
  `showUpperLowerLevels`, `mapperPanelVisible` (could be wired to
  `WindowManager` to open/close `MapPanel`).
- **Media:** `muteMediaAPI`, `muteMediaGame` (`SoundManager` has stop/pause but
  no persistent mute gate).
- **Misc UI / logging:** `showTabConnectionIndicators`, `logInHTML`.

## Tests

`tests/scripting/config-api.test.ts` drives the Lua globals end-to-end:
structured routing into `protocols`/`mapper`/`autoClearInput`, inverse
`specialForce*Off` flags, live `showSentText` echo suppression, enum rejection,
read-only keys, unknown-key handling, and the `Other.lua` table / no-arg-dump
forms.

## Adding a new config key

1. **Has a real backing field?** Add a `case` to both `getConfig` and
   `setConfig` in `ScriptingAPI.ts` routing to it (use the `getProtocol` /
   `getMapperField` helpers or `patchConnectionProfile`).
2. **No backing yet?** Add it to `CONFIG_PERSIST_ONLY` with its `type`
   (+ `enum` if applicable) and a sensible default, and list it under
   "Not implemented" here.
3. If Mudlet treats it as read-only, add it to the read-only `case` arm.
4. Extend `tests/scripting/config-api.test.ts`.

> The completion catalogue already lists `getConfig` / `setConfig` generically
> (`luaCompletions.ts`); individual keys are not separate completions.
