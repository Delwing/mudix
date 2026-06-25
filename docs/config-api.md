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
        → WindowManager.open/hide('map')  (mapperPanelVisible, live)
        → ProfileSettings.config bag  (persist-only + UI-consumed keys)
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
| `enableMNES` | `protocols.mnes` | next connect — restricted core variable set (telnet option 39) |
| `enableNEWENVIRON` / `enableNewEnviron` | `protocols.newEnviron` | next connect — extended NEW-ENVIRON variable set (telnet option 39). `enableNEWENVIRON` is Mudlet's canonical (all-caps) key; `enableNewEnviron` is a mudix alias. |
| `enableCHARSET` | `protocols.charset` | next connect — positive form of `specialForceCharsetNegotiationOff` (telnet CHARSET) |
| `enableNAWS` | `protocols.naws` | next connect — window-size negotiation (telnet option 31) |
| `specialForceMxpNegotiationOff` | `!protocols.mxp` | inverse flag |
| `specialForceCharsetNegotiationOff` | `!protocols.charset` | inverse flag |
| `specialForceCompressionOff` | `!protocols.mccp` | inverse flag — forces MCCP (option 86) off |
| `forceNewEnvironNegotiationOff` | `!(protocols.mnes \|\| protocols.newEnviron)` | inverse flag — disables both option-39 variants |
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
| `showSentText` | Three-state echo mode stored in `MudSession.showSentText` (`'never'` / `'script'` / `'always'`). `never` suppresses the local echo of sent commands entirely; `script` (default) echoes unless a script passes `send(cmd, false)`; `always` echoes even then. Booleans / boolean-ish strings are accepted for back-compat (`true`→`script`, `false`→`never`); an unknown mode string is rejected (`setConfig`→`false`). Persisted to the `config` bag and re-applied on profile load (constructor of `ScriptingAPI`). **Credentials are exempt:** the auto-login password goes through `MudSession.sendSecret()`, which never echoes regardless of mode; user-typed passwords are also safe because `echoCommand` is gated on `shouldEchoCommand()` (false while the server is in password/echo-off mode). |
| `blankLinesBehaviour` | How empty server lines render in the main output (`'show'` / `'hide'` / `'replacewithspace'`). Stored live in `MudSession.blankLinesBehaviour` and read per-line by `ScriptingEngine.processFlushBatch`: `show` (default) renders the blank line as-is, `hide` suppresses it entirely, `replacewithspace` renders it as a single space (Mudlet's screen-reader workaround for QTBUG-105035 — see `TBuffer.cpp`). Scoped to `mud`-typed output, so echoes/errors are unaffected (matching Mudlet's TBuffer-only handling). An unknown mode string is rejected (`setConfig`→`false`). Persisted to the `config` bag and re-applied on profile load (`ScriptingAPI` constructor). **mudix note:** `show` already pads an empty line to `&nbsp;` so it keeps its height, so `show` and `replacewithspace` look near-identical in mudix; `hide` is the visibly distinct mode. |
| `mapperPanelVisible` | Opens (`true`) or hides (`false`) the docked `MapPanel` via `WindowManager` — the same action as the toolbar's map button. `getConfig` reports the live `isVisible('map')`. Not persisted (window visibility is ephemeral window state, restored from the layout snapshot). |
| `muteMediaAPI` | Mutes media triggered by the scripting API (`playSoundFile` / `playMusicFile`). Forwarded to `SoundManager.setOriginMuted('api', …)`: currently-playing API sources are silenced in place (gain → 0, position keeps advancing) and new API sources start silent; unmuting restores audibility mid-track — mirroring Mudlet toggling `QAudioOutput::setMuted` on the live `MediaProtocolAPI` players. Persisted to the `config` bag and re-applied on profile load (`ScriptingAPI` constructor). `getConfig` reports the live `SoundManager.isOriginMuted('api')`. |
| `muteMediaGame` | Same as `muteMediaAPI` but for server-driven media — MSP `!!SOUND`/`!!MUSIC` and GMCP media (Mudlet's `MediaProtocolMSP`/`MediaProtocolGMCP`). Forwarded to `SoundManager.setOriginMuted('game', …)`; the MSP dispatch in `ScriptingEngine` tags its plays with `origin: 'game'`. |

### 2a. Config-bag keys consumed by the UI

Stored in the `ProfileSettings.config` bag (so `get`/`set` round-trip and the
Settings UI writes the same slot), but read back out by the React layer to drive
real behaviour:

| Config key | Effect | Read by |
|---|---|---|
| `commandLineHistorySaveSize` | Caps how many sent commands are persisted to `localStorage` for recall/Tab-completion. Default 500 (= in-memory `MAX_HISTORY`); history is shared across profiles. | `CommandBar` → `useCommandHistory` |
| `showTabConnectionIndicators` | When `true` (default), prefixes the window/tab title with a connection-status dot (🟢/🟡/🔴). The profile name is always shown. mudix has no tab strip, so this lives in the title. | `ProfileSession` |
| `fixUnnecessaryLinebreaks` | When `true` (default `false`) and the session is GA-driven, strips a single spurious leading newline from the start of each GA-terminated data block — Mudlet's "Fix unnecessary linebreaks on GA servers" (`mUSE_IRE_DRIVER_BUGFIX`, `cTelnet::gotPrompt`), for IRE-style servers that prepend a stray `<LF>` to every transmission. ANSI SGR escapes at the block start are skipped before the newline check. Forwarded to `MudClient.setFixUnnecessaryLinebreaks` via `MudSession`. **Deviation:** the very first transmission (before the first GA latches GA-driver mode) keeps its leading newline, since mudix emits whole lines eagerly and can't tell the session is GA-driven until that GA arrives. | `ProfileSession` → `MudSession` → `MudClient` |
| `enableBlinkText` | When `true`, ANSI blink (SGR 5/6) renders as a smooth opacity pulse; when `false` (default — matching Mudlet) blinking text is shown in italics instead. `FormatState.toHtml` always emits the `ansi-slow-blink`/`ansi-rapid-blink` classes; the effect toggles a `blink-text-enabled` class on the document root, and `App.css` picks the pulse-vs-italic presentation from it (so it covers the main output, user windows, and mini-consoles alike). | `ProfileSession` → `<html>` class → `App.css` |

### 3. Persist-only — round-trips but **not yet enforced**

Stored in the `ProfileSettings.config` bag (`CONFIG_PERSIST_ONLY` in
`ScriptingAPI.ts`) with type + enum validation, so `get`/`set` round-trip
faithfully and first reads return a Mudlet-ish default — but mudix does **not
act on them yet**. Each needs a real feature behind it (see "Not implemented"
below). String keys with an `enum` reject out-of-range writes (`setConfig`
returns `false`).

`advertiseScreenReader`, `ambiguousEAsianWidthCharacters` (`auto`/`wide`/`narrow`),
`announceIncomingText`, `askTlsAvailable`,
`caretShortcut` (`none`/`tab`/`ctrltab`/`f6`),
`compactInputLine`, `controlCharacterHandling` (`asis`/`oem`/`picture`),
`editorAutoComplete`, `enableClosedCaption`, `f3SearchEnabled`,
`inputLineStrictUnixEndings`, `logInHTML`,
`promptForMXPProcessorOn`, `promptForVersionInTTYPE`, `show3dMapView`,
`showRoomIdsOnMap`, `showUpperLowerLevels`,
`specialForceGAOff`, `versionInTTYPE`.

(`commandLineHistorySaveSize`, `showTabConnectionIndicators`,
`fixUnnecessaryLinebreaks`, and `enableBlinkText` also live in the `config` bag
but are now consumed by the UI — see group 2a.)

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
- **Rendering:** `controlCharacterHandling`, `ambiguousEAsianWidthCharacters`.
- **Input line / editor:** `compactInputLine`, `inputLineStrictUnixEndings`,
  `editorAutoComplete`, `f3SearchEnabled`.
- **Telnet edge switches:** `askTlsAvailable`, `specialForceGAOff`,
  `versionInTTYPE`, `promptForVersionInTTYPE`, `promptForMXPProcessorOn`.
- **Map:** `show3dMapView` (no 3D renderer), `showRoomIdsOnMap`,
  `showUpperLowerLevels`.
- **Misc UI / logging:** `logInHTML`.

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
