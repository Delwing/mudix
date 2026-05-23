import { type OutputRendererControls } from '../output/OutputRenderer';
import type { Console } from '../../mud/text/Console';
import type { AnsiAwareBuffer } from '../../mud/text/FormatState';
import type { DockSide, WindowHandle, WindowOpenOptions, ScriptWindowRenderData } from './types';
import { MapStore } from '../../map/MapStore';
import { saveMap as saveMapToStorage, loadMap as loadMapFromStorage } from '../../storage/mapStorage';
import { readMapFromBuffer, writeMapToBuffer } from 'mudlet-map-binary-reader';
import { parseMapInWorker } from '../../map/mapParserClient';
import { Buffer } from 'buffer';

interface ScriptWindowData extends ScriptWindowRenderData {
    pendingText: Array<string | AnsiAwareBuffer>;
    /** Pre-mount holding cell for the latest partial line (script echo without
     *  a trailing newline). Only the most-recent value matters — the renderer
     *  paints partials in-place — so we overwrite rather than queue. */
    pendingPartial?: AnsiAwareBuffer;
}

interface WindowCmdLineState {
    /** Lua callback fired on Enter. When null/undefined, Enter falls through to
     *  the main connection (mirrors Mudlet's pre-setCmdLineAction default). */
    action: ((text: string) => void) | null;
}

interface ScrollState {
    scrollBarVisible: boolean;
    horizontalScrollBarVisible: boolean;
    scrollingEnabled: boolean;
}

const DEFAULT_SCROLL_STATE: ScrollState = {
    scrollBarVisible: true,
    horizontalScrollBarVisible: false,
    scrollingEnabled: true,
};

const TEXT_BUFFER_LIMIT = 5000;

const DEFAULT_SIZE: Record<'text' | 'html' | 'map', { w: number; h: number }> = {
    text: { w: 400, h: 300 },
    html: { w: 400, h: 300 },
    map:  { w: 500, h: 400 },
};

const DEFAULT_DOCK_EXTENTS: Record<DockSide, number> = {
    left: 250, right: 250, top: 150, bottom: 150,
};

export type WindowsChangedFn = (
    windows: ScriptWindowRenderData[],
    dockExtents: Record<DockSide, number>,
) => void;

export class WindowManager {
    readonly mapStore = new MapStore();
    private readonly windows       = new Map<string, ScriptWindowData>();
    private readonly controls      = new Map<string, OutputRendererControls>();
    private readonly elements      = new Map<string, HTMLElement>();
    /** Outer panel element used by getSize / sysUserWindowResizeEvent. Distinct
     *  from `elements` (the writable text/HTML target) so size queries report the
     *  full user-window box that labels live in, not the inner output area. */
    private readonly viewports     = new Map<string, HTMLElement>();
    private readonly lineBuffers   = new Map<string, string>();
    /** Per-window scroll/scrollbar overrides applied via CSS classes when the
     *  console's wrapper element registers. Mudlet's enable/disable Scrolling
     *  and (Horizontal)ScrollBar APIs back into this. */
    private readonly scrollState   = new Map<string, ScrollState>();
    private readonly portalTargets = new Map<string, HTMLDivElement>();
    private readonly resizeObservers = new Map<string, ResizeObserver>();
    private readonly lastEmittedSize = new Map<string, { w: number; h: number }>();
    private readonly activeTabGroups = new Map<string, string>(); // groupId → active panelId
    /** Per-window command-line state. Keyed by window id; entry exists only
     *  after enableCommandLine. The actual rendered <input> lives in TextPanel
     *  /HtmlPanel and pulls its enabled/css/value from the ScriptWindowRenderData
     *  payload that notify() emits — this map only carries non-serializable
     *  state (the Lua callback). */
    private readonly cmdLineState = new Map<string, WindowCmdLineState>();
    private readonly mapCallbacks  = new Map<string, (roomId: number) => void>();
    private mapLoadCallback: ((buf?: ArrayBuffer) => boolean) | null = null;
    /** Single in-flight bootstrap promise — both ScriptingEngine.start (which
     *  awaits the map before applying scripts, Mudlet parity) and MapPanel on
     *  mount call into this; whichever lands first triggers the work. */
    private mapBootstrapInflight: Promise<boolean> | null = null;
    private _connectionId = '';
    /** Names of windows created by Lua createMiniConsole — distinguishes them
     *  from openUserWindow panels for windowType() reporting. */
    private mainViewportEl: HTMLElement | null = null;
    private readonly miniConsoles  = new Set<string>();
    private consoleRegistry: Map<string, Console> | null = null;
    private windowHints: Record<string, WindowOpenOptions> = {};
    private nextZ       = 10;
    private nextDockOrder = 0;
    private readonly dockExtents: Record<DockSide, number> = { ...DEFAULT_DOCK_EXTENTS };

    onWindowsChange?:     WindowsChangedFn;
    onWindowHint?:        (id: string, hint: WindowOpenOptions) => void;
    /** Called when a window is explicitly closed — use to clear its auto-open flag. */
    onWindowClosed?:      (id: string) => void;
    /** Called when a dock side's extent changes — use to persist it. */
    onDockExtentsChange?: (extents: Record<DockSide, number>) => void;
    /** Called when a map window is opened or made visible. */
    onMapOpen?:           (id: string) => void;
    /** Bridge to ScriptingEngine.raiseEvent — used to fire system events
     *  (e.g. sysUserWindowResizeEvent) from window-lifecycle code. */
    onRaiseEvent?:        (event: string, args: unknown[]) => void;

    setConsoleRegistry(registry: Map<string, Console>): void {
        this.consoleRegistry = registry;
    }

    setWindowHints(hints: Record<string, WindowOpenOptions>): void {
        this.windowHints = hints;
        // Auto-restore windows that were open when the connection was last closed.
        for (const [id, hint] of Object.entries(hints)) {
            if (hint.autoOpen && !this.windows.has(id)) {
                this.open(id, hint);
            }
        }
    }

    /** Restore saved dock extents from storage (called on connect, before setWindowHints). */
    setDockExtentsFromStorage(extents: Record<string, number>): void {
        for (const [side, size] of Object.entries(extents)) {
            if (size !== undefined) this.dockExtents[side as DockSide] = size;
        }
        this.notify();
    }

    /** Call after setting onWindowsChange to deliver current state immediately.
     *  Needed because windows may have been opened (e.g. autoOpen) before the
     *  React subscriber mounted. */
    initialize(): void {
        this.notify();
    }

    // ── saveWindowLayout / loadWindowLayout ───────────────────────────────────

    /**
     * Snapshot the current window hints + dock extents. Returned object is a
     * deep copy — safe to persist without aliasing the live state. Backs
     * Mudlet's `saveWindowLayout()`.
     */
    captureLayoutSnapshot(): { hints: Record<string, WindowOpenOptions>; dockExtents: Record<DockSide, number> } {
        return {
            hints: structuredClone(this.windowHints),
            dockExtents: { ...this.dockExtents },
        };
    }

    /**
     * Re-apply a previously captured snapshot to the live state. Backs
     * Mudlet's `loadWindowLayout()`. Behaviour:
     *   - Replaces the stored windowHints + dockExtents with the snapshot.
     *   - For each currently open window with a snapshot entry, rewrites its
     *     geometry / dock state / style fields in place (keeps pendingText,
     *     controls, miniconsole content intact).
     *   - For each snapshot hint with no current window, opens the window when
     *     the snapshot recorded it as visible (hidden !== true).
     * `onWindowHint` / `onDockExtentsChange` callbacks fire so the persistence
     * layer mirrors the restored state.
     */
    applyLayoutSnapshot(snapshot: { hints: Record<string, WindowOpenOptions>; dockExtents: Record<string, number> }): void {
        // 1) Dock extents
        for (const [side, size] of Object.entries(snapshot.dockExtents)) {
            if (size !== undefined) this.dockExtents[side as DockSide] = size;
        }
        this.onDockExtentsChange?.({ ...this.dockExtents });

        // 2) Replace the hint cache. structuredClone so subsequent saveHint
        //    mutations don't write back into the snapshot object.
        this.windowHints = structuredClone(snapshot.hints);

        // 3) Re-apply hints to currently open windows.
        for (const [id, hint] of Object.entries(this.windowHints)) {
            const win = this.windows.get(id);
            if (!win) continue;

            if (hint.x          !== undefined) win.x          = hint.x;
            if (hint.y          !== undefined) win.y          = hint.y;
            if (hint.width      !== undefined) win.width      = hint.width;
            if (hint.height     !== undefined) win.height     = hint.height;
            if (hint.title      !== undefined) win.title      = hint.title;

            win.docked     = hint.docked;
            win.dockOrder  = hint.dockOrder;
            win.dockFlex   = hint.dockFlex;
            win.dockGroup  = hint.dockGroup;
            win.tabOrder   = hint.tabOrder;
            win.splitGroup = hint.splitGroup;
            win.splitOrder = hint.splitOrder;
            win.splitFlex  = hint.splitFlex;

            win.fontSize        = hint.fontSize;
            win.fontFamily      = hint.fontFamily;
            win.wrapAt          = hint.wrapAt;
            win.backgroundColor = hint.backgroundColor;
            win.backgroundImage = hint.backgroundImage;

            // Snapshot is authoritative for visibility: hidden flag flips the
            // current state. Don't bump zIndex — preserve relative stacking.
            win.visible = hint.hidden !== true;

            if (hint.dockGroup) {
                if (hint.isActiveTab || !this.activeTabGroups.has(hint.dockGroup)) {
                    this.activeTabGroups.set(hint.dockGroup, id);
                }
            }
        }

        // 4) Open windows that the snapshot has but are not currently mounted,
        //    provided they were visible at save time. Use `ignoreHint: false`
        //    semantics — pass the hint directly via options so open() lays the
        //    window out from the snapshot rather than from any stale prior
        //    state. autoOpen is preserved by spreading the saved hint.
        for (const [id, hint] of Object.entries(this.windowHints)) {
            if (this.windows.has(id)) continue;
            if (hint.hidden === true) continue;
            if (!hint.kind) continue;
            this.open(id, hint);
        }

        // 5) Persist the restored hints (so the live store mirrors the
        //    snapshot, and a later save without intervening edits is a no-op).
        for (const [id, hint] of Object.entries(this.windowHints)) {
            this.onWindowHint?.(id, hint);
        }

        this.notify();
    }

    // ── Portal target ─────────────────────────────────────────────────────────

    /** Returns the stable portal-target div for a window, creating it on first call.
     *  This div is physically moved between dock slots and floating frames — the
     *  panel component rendered into it never unmounts during transitions. */
    getOrCreatePortalTarget(id: string): HTMLDivElement {
        if (!this.portalTargets.has(id)) {
            const div = document.createElement('div');
            div.style.display = 'contents';
            this.portalTargets.set(id, div);
        }
        return this.portalTargets.get(id)!;
    }

    getPortalTarget(id: string): HTMLDivElement | undefined {
        return this.portalTargets.get(id);
    }

    // ── Panel mount / unmount ─────────────────────────────────────────────────

    registerTextPanel(id: string, controls: OutputRendererControls, element: HTMLElement): void {
        this.controls.set(id, controls);
        const win = this.windows.get(id);
        if (win?.pendingText.length) {
            // Drive the renderer's partial-completion path by tagging completed
            // lines with type 'script' so a previously-buffered script-partial
            // would be replaced in-place (matches the main-output flow).
            for (const line of win.pendingText) controls.push(line, 'script');
            win.pendingText = [];
        }
        if (win?.pendingPartial && win.pendingPartial.length > 0) {
            controls.push(win.pendingPartial, 'script-partial');
            win.pendingPartial = undefined;
        }
        this.elements.set(id, element);
        this.applyScrollClasses(id);
    }

    /** Registers the outer panel element for size queries and sysUserWindowResizeEvent.
     *  Distinct from the writable element registered via registerTextPanel /
     *  register('html'): labels position against this rectangle, so getUserWindowSize
     *  must report it (not the inner output area). */
    registerViewport(id: string, element: HTMLElement): void {
        this.viewports.set(id, element);
        this.observeResize(id, element);
        // Re-render: parented miniconsoles whose parent just mounted need a
        // chance to portal into the freshly registered viewport.
        this.notify();
    }

    getViewport(id: string): HTMLElement | undefined {
        return this.viewports.get(id);
    }

    /** OutputArea registers the main `.output-wrapper` here so getColumnCount()
     *  can measure character width against the actual rendered element. */
    registerMainOutput(element: HTMLElement | null): void {
        if (element) {
            this.elements.set('main', element);
            this.applyScrollClasses('main');
        } else {
            this.elements.delete('main');
        }
    }

    /**
     * Registers the full main-viewport element (the one that spans the entire
     * console area including any setBorderTop/Bottom/Left/Right insets). Used
     * by getMainWindowSize so label-positioning scripts always see the full
     * window bounds, matching Mudlet semantics where labels live in window
     * coordinates and borders carve space *out of* them.
     */
    registerMainViewport(element: HTMLElement | null): void {
        this.mainViewportEl = element;
        if (element) this.observeResize('main', element);
        else {
            this.resizeObservers.get('main')?.disconnect();
            this.resizeObservers.delete('main');
            this.lastEmittedSize.delete('main');
        }
        // Main-parented miniconsoles portal into this element; re-render so the
        // FloatingWindowLayer picks up the new (or cleared) target.
        this.notify();
    }

    getMainViewportElement(): HTMLElement | null {
        return this.mainViewportEl;
    }

    register(id: string, element: HTMLElement, _kind: 'html'): void {
        this.elements.set(id, element);
        const win = this.windows.get(id);
        if (win?.pendingText.length) {
            for (const line of win.pendingText) {
                if (typeof line === 'string') element.insertAdjacentHTML('beforeend', line);
            }
            win.pendingText = [];
        }
        this.applyScrollClasses(id);
    }

    pushBuffer(id: string, buffer: AnsiAwareBuffer): void {
        if (!this.windows.has(id)) this.open(id, { kind: 'text', title: id });
        const win = this.windows.get(id)!;
        if (win.kind !== 'text') return;
        this.flushLine(id);
        const ctrl = this.controls.get(id);
        if (ctrl) {
            // type='script' lets the renderer finalize a script-partial in-place
            // (instead of leaving an orphan element above the new line).
            ctrl.push(buffer, 'script');
        } else {
            win.pendingText.push(buffer);
            // A completed line supersedes any pending partial that belonged to
            // the same logical line — otherwise registerTextPanel would paint
            // both.
            win.pendingPartial = undefined;
            if (win.pendingText.length > TEXT_BUFFER_LIMIT) {
                win.pendingText.splice(0, win.pendingText.length - TEXT_BUFFER_LIMIT);
            }
        }
    }

    /** Push the current partial-line buffer (script echo without a trailing
     *  newline) so the renderer can paint it in-place via the 'script-partial'
     *  path. Repeated calls update the same DOM element; a subsequent
     *  pushBuffer completes the partial. Pre-mount, the latest partial is
     *  cached on the window and flushed by registerTextPanel. */
    pushPartialBuffer(id: string, buffer: AnsiAwareBuffer): void {
        const win = this.windows.get(id);
        if (!win || win.kind !== 'text') return;
        const ctrl = this.controls.get(id);
        if (ctrl) {
            ctrl.push(buffer, 'script-partial');
        } else {
            win.pendingPartial = buffer;
        }
    }

    registerConsole(id: string, console: Console): void {
        this.consoleRegistry?.set(id, console);
    }

    unregister(id: string): void {
        this.controls.delete(id);
        this.elements.delete(id);
        this.viewports.delete(id);
        this.consoleRegistry?.delete(id);
        this.resizeObservers.get(id)?.disconnect();
        this.resizeObservers.delete(id);
        this.lastEmittedSize.delete(id);
    }

    /** Watch `element` for size changes and raise sysUserWindowResizeEvent
     *  whenever its rendered dimensions differ from the last reported pair.
     *  Catches both floating-window user drags and dock splitter drags through
     *  the same DOM-level signal, so script-driven setSize() calls also fire
     *  the event once the layout settles. */
    private observeResize(id: string, element: HTMLElement): void {
        if (typeof ResizeObserver === 'undefined') return;
        this.resizeObservers.get(id)?.disconnect();
        const observer = new ResizeObserver(() => {
            const rect = element.getBoundingClientRect();
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);
            // Skip the initial 0×0 frame and any spurious zero-size entries
            // that happen during portal moves between dock/floating shells.
            if (w <= 0 && h <= 0) return;
            const last = this.lastEmittedSize.get(id);
            if (last && last.w === w && last.h === h) return;
            this.lastEmittedSize.set(id, { w, h });
            // Mudlet argument order:
            //   sysWindowResizeEvent(width, height)         — main window
            //   sysUserWindowResizeEvent(width, height, name) — user windows
            // GeyserReposition's user-window branch reads `arg.."Container" == window.name`,
            // so the name must be the third arg, not the first.
            if (id === 'main') this.onRaiseEvent?.('sysWindowResizeEvent', [w, h]);
            else               this.onRaiseEvent?.('sysUserWindowResizeEvent', [w, h, id]);
        });
        observer.observe(element);
        this.resizeObservers.set(id, observer);
    }

    registerMapCallback(id: string, cb: (roomId: number) => void): void {
        this.mapCallbacks.set(id, cb);
    }

    unregisterMapCallback(id: string): void {
        this.mapCallbacks.delete(id);
    }

    centerView(roomId: number): void {
        // Mudlet's centerview sets the player room (mRoomIdHash) as a side
        // effect, so getPlayerRoom() returns this id afterwards.
        this.mapStore.setPlayerRoom(roomId);
        for (const cb of this.mapCallbacks.values()) cb(roomId);
    }

    /** Set by MapPanel on mount; cleared on unmount. The callback parses+renders
     *  a buffer (when given) or reloads from IndexedDB (when omitted). */
    registerMapLoadCallback(cb: (buf?: ArrayBuffer) => boolean): void {
        this.mapLoadCallback = cb;
    }

    unregisterMapLoadCallback(): void {
        this.mapLoadCallback = null;
    }

    setConnectionId(id: string): void {
        this._connectionId = id;
    }

    /**
     * Parse a Mudlet `.dat` buffer and apply it to this session's MapStore.
     * Rooms / areas / hashes / labels / env colours / map-level user data all
     * land in {@link MapStore} via {@link MapStore.loadFromBinary}; the
     * renderer reads it back through the live {@link MudixMapReader}. Throws
     * on parse failure so callers can surface the error (the file-upload path
     * in MapPanel turns it into status='error'; bootstrap logs and moves on).
     */
    ingestMapBuffer(buf: ArrayBuffer): void {
        const mudletMap = readMapFromBuffer(Buffer.from(buf));
        this.mapStore.loadFromBinary(mudletMap);
    }

    /**
     * Async sibling of {@link ingestMapBuffer} that parses in a worker so the
     * main thread stays free for paint. `buf` is transferred — callers that
     * also need the bytes (e.g. IndexedDB persistence) must clone first.
     */
    async ingestMapBufferAsync(buf: ArrayBuffer): Promise<void> {
        const mudletMap = await parseMapInWorker(buf);
        this.mapStore.loadFromBinary(mudletMap);
    }

    /**
     * Mudlet parity: a map is available to scripts before `sysLoadEvent` fires.
     * ScriptingEngine awaits this in its start() path so the initial script
     * load runs against an initialized MapStore (and the binary's hashes + user
     * data when one is persisted). Idempotent — the first caller kicks off the
     * IndexedDB fetch, everyone else awaits the same promise. Returns true
     * when a persisted map was successfully ingested.
     */
    async bootstrapMap(): Promise<boolean> {
        if (this.mapBootstrapInflight) return this.mapBootstrapInflight;
        this.mapBootstrapInflight = (async () => {
            // Mudlet starts the session with an initialized (possibly empty)
            // map — calling newEmptyMap() flips isInitialized() so scripts can
            // start adding rooms without first calling it themselves.
            this.mapStore.newEmptyMap();
            if (!this._connectionId) return false;
            try {
                const buf = await loadMapFromStorage(this._connectionId);
                if (!buf) return false;
                // Off-main-thread parse — the boot path is what dominates LCP,
                // and the binary reader's Buffer-polyfill loop is the single
                // biggest synchronous cost when a saved map is large.
                await this.ingestMapBufferAsync(buf);
                return true;
            } catch (err) {
                console.warn('[WindowManager] bootstrapMap failed:', err);
                return false;
            }
        })();
        return this.mapBootstrapInflight;
    }

    /**
     * Mudlet `loadMap([location])`. With a buffer the bytes are persisted to
     * IndexedDB (so the map survives panel close/reopen and reload), parsed
     * into the manager/store, and any open MapPanel is asked to re-render.
     * Without a buffer the panel is told to reload from cache. Returns false
     * on synchronous parse failure; the IndexedDB write is fire-and-forget
     * (failures appear in console.warn). Fires sysMapLoadEvent on success.
     */
    loadMap(buf?: ArrayBuffer): boolean {
        if (buf && this._connectionId) {
            // Clone for IndexedDB: the parser (qtdatastream's QString.read)
            // mutates the buffer in-place via Buffer.swap16() to convert
            // UTF-16 BE → LE for toString('ucs2'). saveMap awaits openDb()
            // before put() does its structured clone, but the synchronous
            // ingest below runs first — so without a copy IDB persists
            // parser-mutated bytes, and the next mount loads them and
            // double-swaps QString regions into CJK garbage.
            saveMapToStorage(this._connectionId, buf.slice(0)).catch(err =>
                console.warn('[WindowManager] saveMap failed:', err));
            try {
                this.ingestMapBuffer(buf);
            } catch (err) {
                console.warn('[WindowManager] loadMap parse failed:', err);
                return false;
            }
        }
        // The panel callback is advisory — its return value reports render
        // success, but sysMapLoadEvent fires on successful data ingest so
        // headless scripts (no MapPanel open) still receive the event.
        this.mapLoadCallback?.(buf);
        if (buf) this.onRaiseEvent?.('sysMapLoadEvent', []);
        return true;
    }

    /**
     * Mudlet `saveMap([location])`. Serialises the in-memory MapStore to the
     * Mudlet binary `.dat` format and persists it to this connection's
     * IndexedDB slot — the equivalent of Mudlet's default profile map path,
     * picked up by {@link bootstrapMap} on next session start. Returns the
     * serialised bytes so the Lua binding can also write them to a VFS path
     * when the caller supplies one. Returns null when there is no connection
     * or serialisation fails.
     */
    saveMap(): ArrayBuffer | null {
        let bytes: ArrayBuffer;
        try {
            const buf = writeMapToBuffer(this.mapStore.toMudletMap());
            // Copy into a freshly-allocated standalone ArrayBuffer — the
            // returned Buffer is a view onto a Node Buffer pool (and at the
            // type level its .buffer may be SharedArrayBuffer), neither of
            // which the binary reader or IDB persistence can handle directly.
            const out = new ArrayBuffer(buf.byteLength);
            new Uint8Array(out).set(buf);
            bytes = out;
        } catch (err) {
            console.warn('[WindowManager] saveMap serialisation failed:', err);
            return null;
        }
        if (this._connectionId) {
            // Same swap16 hazard as loadMap: the binary reader mutates buffers
            // in-place when parsing QStrings. Cloning before IDB persistence
            // keeps the bytes we return safe if anything later round-trips them
            // through readMapFromBuffer.
            saveMapToStorage(this._connectionId, bytes.slice(0)).catch(err =>
                console.warn('[WindowManager] saveMap persist failed:', err));
        }
        return bytes;
    }

    markAsMiniConsole(id: string): void {
        if (this.windows.has(id)) this.miniConsoles.add(id);
    }

    isMiniConsole(id: string): boolean {
        return this.miniConsoles.has(id);
    }

    getRoomIDbyHash(hash: string): number | undefined {
        return this.mapStore.getRoomIDbyHash(hash);
    }

    // ── Floating window drag / resize ─────────────────────────────────────────

    setPosition(id: string, x: number, y: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.x = x;
        win.y = y;
        this.notify();
        this.saveHint(id, win);
    }

    /** Mudlet setFontSize for a userwindow / miniconsole. Returns false if the
     *  window doesn't exist. Mudlet clamps font size between 1 and 99. */
    setFontSize(id: string, size: number): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        if (!Number.isFinite(size) || size < 1 || size > 99) return false;
        win.fontSize = Math.round(size);
        this.notify();
        this.saveHint(id, win);
        return true;
    }

    getFontSize(id: string): number | null {
        const win = this.windows.get(id);
        return win?.fontSize ?? null;
    }

    /** Mudlet setFont for a userwindow / miniconsole. Empty string clears the
     *  override and lets the inherited font take over. */
    setFont(id: string, family: string): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        win.fontFamily = family && family.trim() ? family : undefined;
        this.notify();
        this.saveHint(id, win);
        return true;
    }

    getFont(id: string): string | null {
        const win = this.windows.get(id);
        return win?.fontFamily ?? null;
    }

    /** Mudlet setWindowWrap. 0 (or any non-positive value) clears the override. */
    setWrap(id: string, wrapAt: number): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        if (!Number.isFinite(wrapAt)) return false;
        const v = Math.round(wrapAt);
        win.wrapAt = v > 0 ? v : undefined;
        this.notify();
        this.saveHint(id, win);
        return true;
    }

    getWrap(id: string): number | null {
        const win = this.windows.get(id);
        return win?.wrapAt ?? null;
    }

    // ── Scrollbar / scrolling ─────────────────────────────────────────────────

    /** Mudlet enable/disableScrollBar — toggle the vertical scrollbar's visibility
     *  on a console wrapper. Wheel/keyboard scrolling continues regardless; only
     *  the gutter rendering is affected. Persists across mounts; idempotent. */
    setScrollBarVisible(id: string, visible: boolean): void {
        this.getScrollStateMut(id).scrollBarVisible = visible;
        this.applyScrollClasses(id);
    }

    /** Mudlet enable/disableHorizontalScrollBar — toggle a horizontal scrollbar
     *  on a console wrapper. mudix wraps long lines by default so this is rarely
     *  needed; included for parity. */
    setHorizontalScrollBarVisible(id: string, visible: boolean): void {
        this.getScrollStateMut(id).horizontalScrollBarVisible = visible;
        this.applyScrollClasses(id);
    }

    /** Mudlet enable/disableScrolling — when disabled, the wrapper sticks to the
     *  bottom (wheel/touch/keys cannot scroll back). Mudlet forbids this on the
     *  main window; we follow that policy. Returns false on 'main', true otherwise. */
    setScrollingEnabled(id: string, enabled: boolean): boolean {
        if (id === 'main') return false;
        this.getScrollStateMut(id).scrollingEnabled = enabled;
        this.applyScrollClasses(id);
        return true;
    }

    /** Buffer-line index of the topmost visible line in `id`'s wrapper. In tail
     *  mode returns the last line number (matching Mudlet's mCursorY behaviour at
     *  the end of the buffer). Returns 0 if the element is unmounted or empty.
     *
     *  Uses getBoundingClientRect rather than offsetTop because `.output-container`
     *  is `position: relative` — child offsetTop is relative to *that*, not to the
     *  scroll-container `.output-wrapper`, so the rectangles are the unambiguous
     *  way to relate child position to the scroll viewport. */
    getScrollLine(id: string): number {
        const el = this.elements.get(id);
        if (!el) return 0;
        const lineEls = this.lineElements(el);
        const total = lineEls.length;
        if (total === 0) return 0;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom <= 1) return total - 1;
        const containerTop = el.getBoundingClientRect().top;
        for (let i = 0; i < total; i++) {
            const rect = lineEls[i].getBoundingClientRect();
            // First line whose bottom edge sits inside the viewport — that's the
            // topmost partly-visible line. -1 tolerates sub-pixel rounding.
            if (rect.bottom > containerTop + 1) return i;
        }
        return total - 1;
    }

    /** Scroll `id`'s wrapper so `line` (0-indexed) sits at the top. `undefined`
     *  resumes tail mode (scroll-to-bottom); negative values count from the end
     *  (Mudlet semantics). Returns false if the wrapper is not mounted. */
    scrollToLine(id: string, line: number | undefined): boolean {
        const el = this.elements.get(id);
        if (!el) return false;
        if (line === undefined) {
            el.scrollTop = el.scrollHeight;
            return true;
        }
        const lineEls = this.lineElements(el);
        const total = lineEls.length;
        if (total === 0) {
            el.scrollTop = el.scrollHeight;
            return true;
        }
        let target = line;
        if (target < 0) target = Math.max(total + target, 0);
        if (target >= total - 1) {
            el.scrollTop = el.scrollHeight;
            return true;
        }
        if (target <= 0) {
            el.scrollTop = 0;
            return true;
        }
        // Bounding-rect math: convert the line's viewport-relative top into a
        // scroll position within the wrapper. offsetTop is relative to the
        // nearest positioned ancestor (`.output-container`), not to the scroll
        // container, so we can't read it directly.
        const containerRect = el.getBoundingClientRect();
        const lineRect = lineEls[target].getBoundingClientRect();
        el.scrollTop = Math.max(0, lineRect.top - containerRect.top + el.scrollTop);
        return true;
    }

    private getScrollStateMut(id: string): ScrollState {
        let s = this.scrollState.get(id);
        if (!s) {
            s = { ...DEFAULT_SCROLL_STATE };
            this.scrollState.set(id, s);
        }
        return s;
    }

    private applyScrollClasses(id: string): void {
        const el = this.elements.get(id);
        if (!el) return;
        const s = this.scrollState.get(id) ?? DEFAULT_SCROLL_STATE;
        el.classList.toggle('mudix-no-scrollbar', !s.scrollBarVisible);
        el.classList.toggle('mudix-h-scrollbar', s.horizontalScrollBarVisible);
        el.classList.toggle('mudix-no-scrolling', !s.scrollingEnabled);
    }

    /** Direct line-element children of the wrapper (skips the sticky-output
     *  sentinel, which sits at the end with height: 0). */
    private lineElements(el: HTMLElement): HTMLElement[] {
        const out: HTMLElement[] = [];
        for (const child of Array.from(el.children) as HTMLElement[]) {
            if (child.classList.contains('output-msg')) out.push(child);
        }
        return out;
    }

    /** Mudlet setBackgroundColor for a userwindow / miniconsole. */
    setBackgroundColor(id: string, r: number, g: number, b: number, a = 255): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        win.backgroundColor = { r, g, b, a };
        this.notify();
        this.saveHint(id, win);
        return true;
    }

    getBackgroundColor(id: string): { r: number; g: number; b: number; a: number } | null {
        const win = this.windows.get(id);
        return win?.backgroundColor ?? null;
    }

    /** Mudlet setBackgroundImage for a userwindow / miniconsole. */
    setBackgroundImage(id: string, url: string, mode: number): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        win.backgroundImage = { url, mode };
        this.notify();
        this.saveHint(id, win);
        return true;
    }

    /** Mudlet resetBackgroundImage for a userwindow / miniconsole. */
    resetBackgroundImage(id: string): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        win.backgroundImage = undefined;
        this.notify();
        this.saveHint(id, win);
        return true;
    }

    setSize(id: string, width: number, height: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        // Miniconsoles bypass the floating-window minimums — the script picks
        // the exact pixel size, including small/zero dimensions.
        if (this.miniConsoles.has(id)) {
            win.width  = Math.max(0, width);
            win.height = Math.max(0, height);
        } else {
            win.width  = Math.max(150, width);
            win.height = Math.max(80, height);
        }
        this.notify();
        this.saveHint(id, win);
    }

    // ── Per-window command line ───────────────────────────────────────────────

    /** Mudlet enableCommandLine(name). Idempotent. Returns false when the
     *  window doesn't exist. */
    enableCommandLine(id: string): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        if (!this.cmdLineState.has(id)) this.cmdLineState.set(id, { action: null });
        if (win.cmdLineEnabled) return true;
        win.cmdLineEnabled = true;
        this.notify();
        return true;
    }

    /** Mudlet disableCommandLine(name). Idempotent. Returns false when the
     *  window doesn't exist. The action callback is kept so re-enabling
     *  resumes the same binding (matches Mudlet's behaviour). */
    disableCommandLine(id: string): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        if (!win.cmdLineEnabled) return true;
        win.cmdLineEnabled = false;
        this.notify();
        return true;
    }

    /** Mudlet setCmdLineStyleSheet(name, qss). Stored as raw QSS; the panel
     *  translates it through cmdLineQssToScopedCss at render time. Returns
     *  false when the window doesn't exist. */
    setCmdLineStyleSheet(id: string, qss: string): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        win.cmdLineStyleSheet = qss && qss.trim() ? qss : undefined;
        this.notify();
        return true;
    }

    /** Bind the Lua callback fired when the user presses Enter in this
     *  window's command line. Pass null to clear. Returns false when the
     *  window doesn't exist. */
    setCmdLineAction(id: string, cb: ((text: string) => void) | null): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        const state = this.cmdLineState.get(id) ?? { action: null };
        state.action = cb;
        this.cmdLineState.set(id, state);
        return true;
    }

    /** Whether a script has bound a per-window Enter handler. */
    hasCmdLineAction(id: string): boolean {
        return !!this.cmdLineState.get(id)?.action;
    }

    /** Read the bound callback (or null). The TextPanel input invokes this
     *  directly on Enter so the React tree never sees the function. */
    getCmdLineAction(id: string): ((text: string) => void) | null {
        return this.cmdLineState.get(id)?.action ?? null;
    }

    /** Mudlet clearCmdLine([name]) when name is a userwindow — wipes the
     *  input contents. The seq bump forces React to apply the seed even
     *  when the value didn't change. Returns false when the window doesn't
     *  exist or has no command line. */
    clearWindowCmdLine(id: string): boolean {
        const win = this.windows.get(id);
        if (!win || !win.cmdLineEnabled) return false;
        win.cmdLineValue = '';
        win.cmdLineValueSeq = (win.cmdLineValueSeq ?? 0) + 1;
        this.notify();
        return true;
    }

    /** Mudlet printCmdLine([name], text) when name is a userwindow — replaces
     *  the input contents and moves the caret to the end (React side). */
    printWindowCmdLine(id: string, text: string): boolean {
        const win = this.windows.get(id);
        if (!win || !win.cmdLineEnabled) return false;
        win.cmdLineValue = String(text ?? '');
        win.cmdLineValueSeq = (win.cmdLineValueSeq ?? 0) + 1;
        this.notify();
        return true;
    }

    /** Mudlet appendCmdLine([name], text) when name is a userwindow — pushes
     *  `text` onto the end of the current contents. */
    appendWindowCmdLine(id: string, text: string): boolean {
        const win = this.windows.get(id);
        if (!win || !win.cmdLineEnabled) return false;
        win.cmdLineValue = String(win.cmdLineValue ?? '') + String(text ?? '');
        win.cmdLineValueSeq = (win.cmdLineValueSeq ?? 0) + 1;
        this.notify();
        return true;
    }

    /** Used by ScriptingAPI.getCmdLine([name]) when the name targets a window;
     *  returns the cached value last seeded. The actual live input value is
     *  reported by the TextPanel through a register callback (see
     *  registerCmdLineValueProbe). */
    private cmdLineValueProbes = new Map<string, () => string>();
    registerCmdLineValueProbe(id: string, probe: () => string): () => void {
        this.cmdLineValueProbes.set(id, probe);
        return () => {
            if (this.cmdLineValueProbes.get(id) === probe) this.cmdLineValueProbes.delete(id);
        };
    }
    getCmdLineValue(id: string): string {
        const probe = this.cmdLineValueProbes.get(id);
        if (probe) return probe();
        return this.windows.get(id)?.cmdLineValue ?? '';
    }

    bringToFront(id: string): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.zIndex = ++this.nextZ;
        this.notify();
    }

    /** Mudlet lowerWindow for a userwindow — drop below every other floating
     *  window. Computes a fresh below-min zIndex so successive lowerWindow
     *  calls maintain relative order. */
    sendToBack(id: string): void {
        const win = this.windows.get(id);
        if (!win) return;
        let min = Infinity;
        for (const w of this.windows.values()) if (w.id !== id && w.zIndex < min) min = w.zIndex;
        win.zIndex = (Number.isFinite(min) ? min : 10) - 1;
        this.notify();
    }

    // ── Dock management ───────────────────────────────────────────────────────

    dock(id: string, side: DockSide, slotIndex?: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        if (win.dockGroup)  this.removeFromGroup(id);
        if (win.splitGroup) this.removeFromSplitGroup(id);
        const existing = [...this.windows.values()]
            .filter(w => w.docked === side)
            .sort((a, b) => (a.dockOrder ?? 0) - (b.dockOrder ?? 0));
        // Unique dockOrder values represent logical slots (all members of a tab/split
        // group share one dockOrder). Translate the visual slot index to a dockOrder
        // value so that sparse dockOrders (from previous undock/redock cycles) don't
        // cause the panel to land at the wrong position.
        const slotOrders = [...new Set(existing.map(w => w.dockOrder ?? 0))];
        let insertAt: number;
        if (slotIndex === undefined || slotIndex >= slotOrders.length) {
            insertAt = slotOrders.length > 0 ? slotOrders[slotOrders.length - 1] + 1 : 0;
        } else {
            insertAt = slotOrders[slotIndex];
        }
        existing.forEach(w => {
            if ((w.dockOrder ?? 0) >= insertAt) w.dockOrder = (w.dockOrder ?? 0) + 1;
        });
        win.docked    = side;
        win.dockOrder = insertAt;
        win.dockFlex  = 1;
        win.visible   = true;
        this.notify();
        this.saveHint(id, win);
    }

    /** Stack panel `id` as a tab with panel `targetId` (or into its existing group). */
    tabIntoGroup(id: string, targetId: string): void {
        const source = this.windows.get(id);
        const target = this.windows.get(targetId);
        if (!source || !target || !target.docked) return;
        // Leave any existing group membership
        if (source.dockGroup) this.removeFromGroup(id);

        // Get or create the target's group
        let groupId: string;
        if (target.dockGroup) {
            groupId = target.dockGroup;
        } else {
            groupId = `grp_${targetId}`;
            target.dockGroup = groupId;
            target.tabOrder  = 0;
            this.activeTabGroups.set(groupId, targetId);
            this.saveHint(targetId, target);
        }

        const members   = [...this.windows.values()].filter(w => w.dockGroup === groupId);
        const maxOrder  = members.reduce((m, w) => Math.max(m, w.tabOrder ?? 0), -1);

        source.docked    = target.docked;
        source.dockOrder = target.dockOrder;
        source.dockFlex  = target.dockFlex;
        source.dockGroup = groupId;
        source.tabOrder  = maxOrder + 1;
        source.visible   = true;
        // If the target panel lives inside a split group, the new tab member must
        // inherit the same split position so it's rendered inside the split slot.
        if (target.splitGroup) {
            source.splitGroup = target.splitGroup;
            source.splitOrder = target.splitOrder;
            source.splitFlex  = target.splitFlex;
        }

        this.activeTabGroups.set(groupId, id);
        this.notify();
        this.saveHint(id, source);
    }

    setActiveTab(panelId: string): void {
        const win = this.windows.get(panelId);
        if (!win?.dockGroup) return;
        this.activeTabGroups.set(win.dockGroup, panelId);
        this.notify();
    }

    /** Split panel `id` above or below `targetId` (cross-axis within the same dock slot). */
    splitIntoGroup(id: string, targetId: string, splitBefore: boolean): void {
        const source = this.windows.get(id);
        const target = this.windows.get(targetId);
        if (!source || !target || !target.docked) return;
        if (source.dockGroup)  this.removeFromGroup(id);
        if (source.splitGroup) this.removeFromSplitGroup(id);

        let splitGroupId: string;
        if (target.splitGroup) {
            splitGroupId = target.splitGroup;
        } else if (target.dockGroup) {
            // Entire tab group becomes one split member — assign splitGroup to every
            // member so SplitGroupPanel can render the group as a unit without creating
            // a panel that has both dockGroup and splitGroup in isolation.
            splitGroupId = `splt_${target.dockGroup}`;
            const tabSplitOrder = splitBefore ? 1 : 0;
            for (const m of this.windows.values()) {
                if (m.dockGroup !== target.dockGroup) continue;
                m.splitGroup = splitGroupId;
                m.splitOrder = tabSplitOrder;
                m.splitFlex  = 1;
                this.saveHint(m.id, m);
            }
            source.docked     = target.docked;
            source.dockOrder  = target.dockOrder;
            source.dockFlex   = target.dockFlex;
            source.splitGroup = splitGroupId;
            source.splitOrder = splitBefore ? 0 : 1;
            source.splitFlex  = 1;
            source.visible    = true;
            this.notify();
            this.saveHint(id, source);
            return;
        } else {
            splitGroupId = `splt_${targetId}`;
            target.splitGroup = splitGroupId;
            target.splitOrder = 0;
            target.splitFlex  = 1;
            this.saveHint(targetId, target);
        }

        const members  = [...this.windows.values()]
            .filter(w => w.splitGroup === splitGroupId)
            .sort((a, b) => (a.splitOrder ?? 0) - (b.splitOrder ?? 0));
        const targetIdx = members.findIndex(m => m.id === targetId);
        const insertAt  = splitBefore ? (targetIdx < 0 ? 0 : targetIdx) : (targetIdx < 0 ? members.length : targetIdx + 1);

        members.forEach(w => {
            if ((w.splitOrder ?? 0) >= insertAt) w.splitOrder = (w.splitOrder ?? 0) + 1;
        });

        source.docked     = target.docked;
        source.dockOrder  = target.dockOrder;
        source.dockFlex   = target.dockFlex;
        source.splitGroup = splitGroupId;
        source.splitOrder = insertAt;
        source.splitFlex  = 1;
        source.visible    = true;

        this.notify();
        this.saveHint(id, source);
    }

    setSplitFlex(panelId: string, flex: number): void {
        const win = this.windows.get(panelId);
        if (!win?.splitGroup) return;
        const normalized = Math.max(0.05, flex);
        // Update all panels at the same split position (tab group members share a slot)
        for (const w of this.windows.values()) {
            if (w.splitGroup === win.splitGroup && w.splitOrder === win.splitOrder) {
                w.splitFlex = normalized;
                this.saveHint(w.id, w);
            }
        }
        this.notify();
    }

    /** Undock. Pass the panel's screen rect so the floating window appears in-place. */
    undock(id: string, visualWidth?: number, visualHeight?: number, screenX?: number, screenY?: number): void {
        const win = this.windows.get(id);
        if (!win) return;
        if (win.dockGroup)  this.removeFromGroup(id);
        if (win.splitGroup) this.removeFromSplitGroup(id);
        const side = win.docked;
        if (visualWidth  !== undefined) win.width  = visualWidth;
        else if (side === 'left' || side === 'right') win.width = this.dockExtents[side!];
        if (visualHeight !== undefined) win.height = visualHeight;
        else if (side === 'top' || side === 'bottom') win.height = this.dockExtents[side!];
        if (screenX !== undefined) win.x = screenX;
        if (screenY !== undefined) win.y = screenY;
        delete win.docked;
        delete win.dockOrder;
        delete win.dockFlex;
        win.visible = true;
        win.zIndex  = ++this.nextZ;
        this.notify();
        this.saveHint(id, win);
    }

    getDockExtent(side: DockSide): number {
        return this.dockExtents[side];
    }

    setDockExtent(side: DockSide, size: number): void {
        const min = side === 'left' || side === 'right' ? 80 : 50;
        this.dockExtents[side] = Math.max(min, size);
        this.notify();
        this.onDockExtentsChange?.({ ...this.dockExtents });
    }

    setDockFlex(id: string, flex: number): void {
        const win = this.windows.get(id);
        if (!win?.docked) return;
        win.dockFlex = Math.max(0.05, flex);
        this.notify();
        this.saveHint(id, win);
    }

    /** Set flex for all panels in the same slot (by panel ID, tab-group ID, or split-group ID). */
    setSlotFlex(slotId: string, flex: number): void {
        const normalized = Math.max(0.05, flex);
        for (const win of this.windows.values()) {
            if (win.id === slotId || win.dockGroup === slotId || win.splitGroup === slotId) {
                win.dockFlex = normalized;
            }
        }
        this.notify();
        for (const win of this.windows.values()) {
            if (win.id === slotId || win.dockGroup === slotId || win.splitGroup === slotId) {
                this.saveHint(win.id, win);
            }
        }
    }

    // ── Scripting API ─────────────────────────────────────────────────────────

    open(id: string, options: WindowOpenOptions = {}): WindowHandle {
        const existing = this.windows.get(id);
        if (existing) {
            if (options.title) existing.title = options.title;
            existing.visible = true;
            existing.zIndex  = ++this.nextZ;
            this.notify();
            if (existing.kind === 'map') this.onMapOpen?.(id);
            return this.makeHandle(id);
        }

        const kind = options.kind ?? 'text';
        const hint = options.ignoreHint ? undefined : this.windowHints[id];
        const def  = DEFAULT_SIZE[kind];

        // Determine dock state, following Mudlet semantics:
        //   autoDock=false           → always float
        //   hint present             → restore saved dock position
        //   dockingArea (no hint)    → dock to that side
        //   otherwise                → float
        let docked: DockSide | undefined;
        let dockOrder: number | undefined;
        let dockFlex: number | undefined;
        let dockGroup: string | undefined;
        let tabOrder: number | undefined;
        let splitGroup: string | undefined;
        let splitOrder: number | undefined;
        let splitFlex: number | undefined;

        if (options.autoDock === false) {
            // Force floating
        } else if (hint?.docked) {
            docked    = hint.docked;
            dockOrder = hint.dockOrder;
            dockFlex  = hint.dockFlex;
            if (hint.dockGroup) {
                dockGroup = hint.dockGroup;
                tabOrder  = hint.tabOrder;
                if (hint.isActiveTab || !this.activeTabGroups.has(hint.dockGroup)) {
                    this.activeTabGroups.set(hint.dockGroup, id);
                }
            }
            if (hint.splitGroup) {
                splitGroup = hint.splitGroup;
                splitOrder = hint.splitOrder;
                splitFlex  = hint.splitFlex;
            }
        } else if (options.dockingArea && options.dockingArea !== 'main') {
            const areaMap: Partial<Record<string, DockSide>> = {
                left: 'left', right: 'right', top: 'top', bottom: 'bottom',
            };
            docked = areaMap[options.dockingArea];
            if (docked) { dockFlex = 1; dockOrder = ++this.nextDockOrder; }
        }

        const win: ScriptWindowData = {
            id,
            title:       options.title ?? (kind === 'map' ? 'Map' : id),
            kind,
            // Honor `hidden` from options (setWindowHints spreads the saved
            // hint into options for autoOpen restore) but NOT from the bare
            // saved hint — an explicit script `openMapWidget()` or toolbar
            // click should always make the window visible, even when the
            // user's last action was to hide/close it.
            visible:     options.hidden !== true,
            x:           hint?.x      ?? this.defaultX(options.position),
            y:           hint?.y      ?? this.defaultY(options.position),
            width:       hint?.width  ?? options.width  ?? def.w,
            height:      hint?.height ?? options.height ?? def.h,
            zIndex:      ++this.nextZ,
            docked,
            dockOrder,
            dockFlex,
            dockGroup,
            tabOrder,
            splitGroup,
            splitOrder,
            splitFlex,
            fontSize: hint?.fontSize,
            fontFamily: hint?.fontFamily,
            wrapAt: hint?.wrapAt,
            backgroundColor: hint?.backgroundColor,
            backgroundImage: hint?.backgroundImage,
            parent: options.parent,
            // Mudlet's openUserWindow(..., autoDock=false) opens the window
            // floating AND prevents the user from later docking it. Persist
            // the lock so re-opens after layout restore preserve the intent
            // (the saved hint carries the flag through saveHint).
            lockFloating: options.lockFloating ?? hint?.lockFloating ?? (options.autoDock === false ? true : undefined),
            pendingText: [],
        };

        this.windows.set(id, win);
        this.windowHints[id] = {
            ...this.windowHints[id],
            kind:     win.kind,
            autoOpen: options.autoOpen ?? this.windowHints[id]?.autoOpen,
        };
        this.saveHint(id, win);
        this.notify();
        if (kind === 'map') this.onMapOpen?.(id);
        return this.makeHandle(id);
    }

    close(id: string): void {
        this.windows.delete(id);
        this.controls.delete(id);
        this.elements.delete(id);
        this.lineBuffers.delete(id);
        this.portalTargets.delete(id);
        this.consoleRegistry?.delete(id);
        this.miniConsoles.delete(id);
        this.cmdLineState.delete(id);
        this.cmdLineValueProbes.delete(id);
        this.onWindowClosed?.(id);
        this.notify();
    }

    clearAll(): void {
        for (const id of this.windows.keys()) {
            this.controls.delete(id);
            this.elements.delete(id);
            this.lineBuffers.delete(id);
            this.portalTargets.delete(id);
            this.consoleRegistry?.delete(id);
        }
        this.windows.clear();
        this.miniConsoles.clear();
        this.cmdLineState.clear();
        this.cmdLineValueProbes.clear();
        this.notify();
    }

    hide(id: string): void {
        const win = this.windows.get(id);
        if (!win || !win.visible) return;
        win.visible = false;
        this.saveHint(id, win);
        this.notify();
    }

    show(id: string): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        if (win.visible) return true;
        win.visible = true;
        win.zIndex  = ++this.nextZ;
        this.saveHint(id, win);
        this.notify();
        return true;
    }

    isVisible(id: string): boolean {
        return this.windows.get(id)?.visible ?? false;
    }

    write(id: string, text: string): void {
        if (!this.windows.has(id)) this.open(id, { kind: 'text', title: id });
        const win = this.windows.get(id)!;
        if (win.kind === 'map') return;

        const buffered = (this.lineBuffers.get(id) ?? '') + text;
        const lines    = buffered.split('\n');
        for (let i = 0; i < lines.length - 1; i++) this.pushLine(win, id, lines[i]);

        const remainder = lines[lines.length - 1];
        if (remainder) this.lineBuffers.set(id, remainder);
        else           this.lineBuffers.delete(id);
    }

    flushLine(id: string): void {
        const partial = this.lineBuffers.get(id);
        if (!partial) return;
        this.lineBuffers.delete(id);
        const win = this.windows.get(id);
        if (win) this.pushLine(win, id, partial);
    }

    flushAllLines(): void {
        for (const id of this.lineBuffers.keys()) this.flushLine(id);
    }

    clear(id: string): void {
        const win = this.windows.get(id);
        if (!win) return;
        win.pendingText = [];
        win.pendingPartial = undefined;
        this.lineBuffers.delete(id);
        this.controls.get(id)?.clear();
        const el = this.elements.get(id);
        if (el && win.kind === 'html') el.replaceChildren();
        // Also reset the upstream Console — without this the next echo would
        // re-include any pre-clear partial text when drainWindowConsole fires.
        this.consoleRegistry?.get(id)?.clear();
    }

    /**
     * Mudlet setUserWindowTitle(name, [title]) → bool. With a non-empty title
     * the panel header shows that string; with an empty/missing title the
     * window's id is used as the title (matches Mudlet's "reset to default"
     * behaviour). Returns false when the named window doesn't exist.
     */
    setTitle(id: string, title?: string): boolean {
        const win = this.windows.get(id);
        if (!win) return false;
        win.title = title && title.length > 0 ? title : id;
        this.notify();
        return true;
    }

    focus(id: string): void { this.bringToFront(id); }
    has(id: string): boolean { return this.windows.has(id); }
    getElement(id: string): HTMLElement | null { return this.elements.get(id) ?? null; }

    /** Mudlet getUserWindowSize. Reports the live rendered size of a userwindow
     *  / miniconsole when mounted (so docked panels return their actual on-screen
     *  pixels rather than the stored hint), else falls back to the saved width
     *  /height. Returns null if the window doesn't exist. Prefers the viewport
     *  element so the reported box matches the rectangle labels position against —
     *  not the inner output area, which has paddings and a scrollbar gutter. */
    getSize(id: string): { width: number; height: number } | null {
        const win = this.windows.get(id);
        if (!win) return null;
        const el = this.viewports.get(id) ?? this.elements.get(id);
        if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
                return { width: rect.width, height: rect.height };
            }
        }
        return { width: win.width, height: win.height };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private pushLine(win: ScriptWindowData, id: string, line: string): void {
        if (win.kind === 'text') {
            const ctrl = this.controls.get(id);
            if (ctrl) {
                ctrl.push(line);
            } else {
                win.pendingText.push(line);
                if (win.pendingText.length > TEXT_BUFFER_LIMIT) {
                    win.pendingText.splice(0, win.pendingText.length - TEXT_BUFFER_LIMIT);
                    console.warn(`[WindowManager] pre-mount buffer for "${id}" exceeded ${TEXT_BUFFER_LIMIT} lines`);
                }
            }
        } else if (win.kind === 'html') {
            const el = this.elements.get(id);
            if (el) el.insertAdjacentHTML('beforeend', line);
            else    win.pendingText.push(line);
        }
    }

    private defaultX(position?: string): number {
        if (position === 'right') return Math.round(window.innerWidth * 0.6);
        if (position === 'left')  return 20;
        return 20 + (this.windows.size % 8) * 30;
    }

    private defaultY(position?: string): number {
        if (position === 'above') return 20;
        if (position === 'below') return Math.round(window.innerHeight * 0.55);
        return 20 + (this.windows.size % 8) * 30;
    }

    private notify(): void {
        const arr = [...this.windows.values()]
            .map(({ id, title, kind, visible, x, y, width, height, zIndex, docked, dockOrder, dockFlex, dockGroup, tabOrder, splitGroup, splitOrder, splitFlex, fontSize, fontFamily, wrapAt, backgroundColor, backgroundImage, parent, lockFloating, cmdLineEnabled, cmdLineStyleSheet, cmdLineValue, cmdLineValueSeq }) => ({
                id, title, kind, visible, x, y, width, height, zIndex,
                docked, dockOrder, dockFlex, dockGroup, tabOrder, splitGroup, splitOrder, splitFlex,
                fontSize, fontFamily, wrapAt, backgroundColor, backgroundImage, parent, lockFloating,
                cmdLineEnabled, cmdLineStyleSheet, cmdLineValue, cmdLineValueSeq,
                isActiveTab: dockGroup ? this.activeTabGroups.get(dockGroup) === id : undefined,
            }))
            .sort((a, b) => a.zIndex - b.zIndex);
        this.onWindowsChange?.(arr, { ...this.dockExtents });
    }

    private saveHint(id: string, win: ScriptWindowData): void {
        const hint: WindowOpenOptions = {
            x: win.x, y: win.y, width: win.width, height: win.height,
            kind:      win.kind,
            title:     win.title,
            autoOpen:  this.windowHints[id]?.autoOpen,
            hidden:    win.visible ? undefined : true,
            docked:    win.docked,    dockOrder:  win.dockOrder,  dockFlex:  win.dockFlex,
            dockGroup: win.dockGroup, tabOrder:   win.tabOrder,
            isActiveTab: win.dockGroup ? this.activeTabGroups.get(win.dockGroup) === id : undefined,
            splitGroup: win.splitGroup, splitOrder: win.splitOrder, splitFlex: win.splitFlex,
            fontSize:  win.fontSize,
            fontFamily: win.fontFamily,
            wrapAt:    win.wrapAt,
            backgroundColor: win.backgroundColor,
            backgroundImage: win.backgroundImage,
            lockFloating: win.lockFloating,
        };
        this.windowHints[id] = hint;
        this.onWindowHint?.(id, hint);
    }

    private removeFromSplitGroup(id: string): void {
        const win = this.windows.get(id);
        if (!win?.splitGroup) return;
        const groupId = win.splitGroup;
        delete win.splitGroup;
        delete win.splitOrder;
        delete win.splitFlex;

        // Dissolve group when only one distinct split position remains.
        // Tab groups in a split share one splitOrder, so count unique orders not panels.
        const remaining = [...this.windows.values()].filter(w => w.splitGroup === groupId);
        const uniqueOrders = new Set(remaining.map(w => w.splitOrder ?? 0));
        if (uniqueOrders.size <= 1) {
            for (const last of remaining) {
                delete last.splitGroup;
                delete last.splitOrder;
                delete last.splitFlex;
                this.saveHint(last.id, last);
            }
        }
    }

    private removeFromGroup(id: string): void {
        const win = this.windows.get(id);
        if (!win?.dockGroup) return;
        const groupId = win.dockGroup;
        delete win.dockGroup;
        delete win.tabOrder;

        // Switch active tab if this was the active one
        if (this.activeTabGroups.get(groupId) === id) {
            const remaining = [...this.windows.values()].filter(w => w.dockGroup === groupId);
            if (remaining.length > 0) {
                this.activeTabGroups.set(groupId, remaining[0].id);
            } else {
                this.activeTabGroups.delete(groupId);
            }
        }

        // Dissolve group when only one panel remains
        const remaining = [...this.windows.values()].filter(w => w.dockGroup === groupId);
        if (remaining.length === 1) {
            const last = remaining[0];
            delete last.dockGroup;
            delete last.tabOrder;
            this.activeTabGroups.delete(groupId);
            this.saveHint(last.id, last);
        } else if (remaining.length === 0) {
            this.activeTabGroups.delete(groupId);
        }
    }

    private makeHandle(id: string): WindowHandle {
        const m = this;
        return {
            get id()      { return id; },
            get kind()    { return m.windows.get(id)?.kind ?? 'text'; },
            get element() { return m.elements.get(id) ?? document.createElement('div'); },
            write(text)   { m.write(id, text); },
            clear()       { m.clear(id); },
            setTitle(t)   { m.setTitle(id, t); },
            focus()       { m.focus(id); },
            close()       { m.close(id); },
        };
    }
}
