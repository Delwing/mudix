# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server
npm run build      # TypeScript check + production build (tsc && vite build)
npm run preview    # Preview production build
npm run typecheck  # Type-check only (tsc --noEmit)
```

There are no tests at this time.

## What This Is

Mudix is a **web-based MUD (Multi-User Dungeon) client** built with React + TypeScript. It connects to MUD servers via WebSocket (with GMCP protocol support), renders ANSI-colored text output, supports Lua scripting for automation, and provides a dockable multi-panel UI.

Key libraries: `dockview-react` (docking), `wasmoon-lua5.1` (Lua in browser, WASM-compiled Lua 5.1), `mudlet-map-binary-reader/renderer` (map files), `zustand` (state), `pako` (compression).

## Architecture Overview

### Event-Driven Core

`MudSession` owns a `MudClient` (WebSocket) and an `EventBus`. All MUD events flow through `session.events`:

```
MudClient (WebSocket)
  → MudSession.events (flushLines, gmcp, message, status, ping, client.connect/disconnect)
    → ScriptingEngine (Lua handlers, alias processing)
    → React components (OutputPanel, Toolbar, etc.)
```

### Command Processing Pipeline

```
User input (CommandBar)
  → App.handleSend()
  → ScriptingEngine.processInput(text)
      → AliasEngine.processTemp()   // JS temp aliases
      → AliasEngine.matchPerm()     // JS permanent aliases
      → LuaRuntime.processInput()   // PCRE regex aliases in Lua
  → if not consumed: session.send(text)
```

### Scripting Architecture

**`ScriptingEngine`** orchestrates runtimes via the **`IScriptingRuntime`** interface (`load`, `emitEvent`, `processInput`, `runWithMatches`, `destroy`). Only Lua is implemented today but the interface is designed for extension.

**`LuaRuntime`** uses wasmoon-lua5.1 to run Lua in the browser. It exposes the `mudix` global table:

```lua
mudix.send(text)                  -- send command to MUD
mudix.echo/cecho/decho/hecho()    -- output (plain, Mudlet-color, decimal-RGB, hex-RGB)
mudix.windows.open/write/clear/setTitle()
mudix.timers.after(seconds, fn)
mudix.aliases.add(pattern, fn) / .remove(id)
mudix.on(event, handler) / .off()
gmcp                              -- auto-populated table from GMCP packets
matches                           -- [full_input, cap1, cap2, ...] inside alias handlers
```

**`ScriptingAPI`** is the bridge layer — it translates Lua calls into MUD sends, window operations, and timer scheduling. It holds references to `MudSession` and `WindowManager`.

Scripts are stored per-connection in Zustand (`connectionScripts`). When the active connection changes, `App` destroys the old `LuaRuntime` and creates a fresh one, loading each script sequentially.

### Window/Docking System

**`WindowManager`** (`src/ui/windows/WindowManager.ts`): Adapter between the scripting API and dockview. Manages a panel registry, buffers writes before the dockview API is ready, and queues deferred opens.

**`DockRoot`** (`src/ui/windows/DockRoot.tsx`): React wrapper around dockview-react. Registers four panel types:
- `OutputPanel` — main MUD output (locked position, sticky scroll, hidden header)
- `TextPanel` — script-written ANSI text
- `HtmlPanel` — raw HTML injection
- `MapPanel` — Mudlet binary map renderer

Layout is serialized per-connection to Zustand with a 400ms debounce. On restore, live refs (`session`, `manager`) are re-injected since they can't be serialized.

### Storage

**`AppStore`** (`src/storage/appStore.ts`): Zustand with `persist` middleware → `localStorage` key `mudix_v1`. Schema versioning with migration logic (currently v5). Only these keys are persisted: `connections`, `ui`, `connectionLayouts`, `connectionScripts`, `connectionAliases`.

**`mapStorage`** (`src/storage/mapStorage.ts`): Separate IndexedDB (`mudix_maps` DB) for Mudlet binary map data. Async `saveMap(ArrayBuffer)` / `loadMap()`.

**`logStorage`** (`src/storage/logStorage.ts`): Separate IndexedDB (`mudix_logs` DB, `sessions` + `entries` stores) for persisted gameplay logs. `SessionLogger` (`src/logging/SessionLogger.ts`) subscribes to `session.events('message')` — the choke point all output (including echoed commands) flows through — snapshots each line's `toHtml()` + plain text, and batch-writes. Browsable via `LogBrowserModal` (toolbar **Logs** button); export helpers in `logExport.ts`. Per-profile toggle: `ProfileSettings.loggingEnabled` (default on).

### JS API Parity with Mudlet

Every Mudlet API feature needs a JS/Lua equivalent in `ScriptingAPI`, but it should be structured idiomatically for this client — not a 1:1 copy of Mudlet's API surface.
