import type { MudSession, ScriptLogSource } from '../mud/MudSession';
import type { AliasEngine } from '../mud/aliases/AliasEngine';
import type { TriggerEngine } from '../mud/triggers/TriggerEngine';
import type { TimerEngine } from '../mud/timers/TimerEngine';
import type { KeyEngine } from '../mud/keybindings/KeyEngine';
import type { WindowHandle, WindowOpenOptions } from '../ui/windows/types';
import type { LabelManager, LabelCreateOptions, LabelMouseEvent, LabelWheelEvent } from '../ui/labels/LabelManager';
import { userWindowQssToScopedCss, cssEscape } from '../ui/labels/qtCss';
import { AnsiAwareBuffer, type FormatColor, type FormatStateSnapshot, type FormatHyperlink, type RgbColor } from '../mud/text/FormatState';
import { namedColorToState } from '../mud/text/colorParsers';
import { colorCodes } from '../mud/text/colors';
import { Console } from '../mud/text/Console';
import { StopwatchManager, localStorageStopwatchStore } from './StopwatchManager';
import { useAppStore, selectProfileField, connectionUrl } from '../storage';
import {
    getUniversalDefaultFonts,
    getRegisteredFontFamilies,
    getCachedLocalFonts,
    primeLocalFontsCache,
} from '../utils/fontLoader';

// Mudlet's TChar always carries baked-in fg/bg colors (the rendered pair), so
// getFgColor/getBgColor never return "no color" for in-bounds positions. mudix
// buffer segments are sparse — plain text has no explicit color — so we fall
// back to these defaults, matching the dark-theme values SettingsModal uses
// (App.css :root --text / --bg).
const DEFAULT_FG_RGB: [number, number, number] = [0xd4, 0xd4, 0xd4];
const DEFAULT_BG_RGB: [number, number, number] = [0x09, 0x09, 0x09];

const HEX_RE = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
function parseHexToRgb(hex: string | undefined): [number, number, number] | null {
    if (!hex) return null;
    const m = HEX_RE.exec(hex);
    if (!m) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Build a CSS color string from Mudlet-style 0..255 channels (alpha included).
 *  Channels are clamped and rounded; alpha (Mudlet's 0..255 "transparency") is
 *  mapped to CSS's 0..1 range. Used by setCommand{Background,Foreground}Color. */
function rgbaCss(r: number, g: number, b: number, a = 255): string {
    const ch = (n: number) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
    const alpha = Math.max(0, Math.min(1, (Number(a) || 0) / 255));
    return `rgba(${ch(r)}, ${ch(g)}, ${ch(b)}, ${alpha})`;
}

/** Clamp a numeric value to [0, 255] and round. Used by the map colour APIs. */
function clamp255(n: number): number {
    return Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
}

/** Format an epoch-ms timestamp as Mudlet's "hh:mm:ss.zzz" (local time). */
function formatLineTimestamp(ms: number): string {
    const d = new Date(ms);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function formatColorToRgb(color: FormatColor | undefined): [number, number, number] | null {
    if (!color) return null;
    if (color.space === 'rgb') return [color.r, color.g, color.b];
    if (color.space === 'hex') return parseHexToRgb(color.color);
    if (color.space === 'indexed') return parseHexToRgb(colorCodes.xterm[color.index]);
    return null;
}

/**
 * Returns how many monospace characters fit horizontally inside `el`. Used by
 * getColumnCount when the script hasn't pinned a wrap width with setWindowWrap.
 * The probe is hidden and removed before this returns, so it never appears in
 * the output. Returns 0 if the element is missing or has zero width (e.g. not
 * yet mounted, in a hidden tab).
 */
function measureColumnCapacity(el: HTMLElement | null): number {
    if (!el) return 0;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(100);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;letter-spacing:inherit;';
    el.appendChild(probe);
    const charWidth = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (charWidth <= 0) return 0;
    const cs = getComputedStyle(el);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const width = Math.max(0, el.clientWidth - pad);
    return Math.floor(width / charWidth);
}

// Default monospace stack used by the output panels — mirrors --font-mono in
// App.css. Used as the fallback family when the profile has no outputFont set.
const DEFAULT_MONO_STACK = `'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace`;

// Mudlet's getMousePosition() returns the cursor position relative to the
// main console widget. There's no equivalent of QCursor::pos() on the web —
// the browser only exposes the cursor through events — so we passively track
// the last-known viewport-relative position and transform it into main-output
// coordinates on read. Initialised to NaN so getMousePosition can return 0,0
// before any pointer activity (matching Mudlet's "you've never moved" feel
// rather than reporting a stale pre-load position).
let lastPointerClientX = Number.NaN;
let lastPointerClientY = Number.NaN;
if (typeof document !== 'undefined') {
    const track = (e: PointerEvent | MouseEvent) => {
        lastPointerClientX = e.clientX;
        lastPointerClientY = e.clientY;
    };
    document.addEventListener('pointermove', track, { passive: true, capture: true });
    document.addEventListener('mousedown',   track, { passive: true, capture: true });
}

/**
 * Measures the pixel size of an average character cell for `family` at `size`
 * px. Backs Mudlet's `calcFontSize(...)` — scripts use the returned (w, h) to
 * pre-size miniconsoles for a column/row count. The width is measured via a
 * canvas 2D context (monospace fonts have a uniform advance, so any glyph
 * works); height uses the font bounding box ascent+descent when available,
 * falling back to 1.2x size which matches the line-height Qt's QFontMetrics
 * reports for common fonts.
 */
function measureMonospaceCell(family: string, size: number): [number, number] {
    const fallback: [number, number] = [Math.round(size * 0.6), Math.round(size * 1.2)];
    if (typeof document === 'undefined') return fallback;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return fallback;
    const stack = family && family.trim()
        ? `"${family.trim().replace(/"/g, '\\"')}", ${DEFAULT_MONO_STACK}`
        : DEFAULT_MONO_STACK;
    ctx.font = `${size}px ${stack}`;
    const m = ctx.measureText('M');
    const ascent = m.fontBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent;
    const height = (typeof ascent === 'number' && typeof descent === 'number')
        ? ascent + descent
        : size * 1.2;
    return [Math.round(m.width), Math.round(height)];
}

// ── Windows ───────────────────────────────────────────────────────────────────

class ScriptingWindowsAPI {
    constructor(private readonly session: MudSession) {}

    open(id: string, options?: WindowOpenOptions): WindowHandle {
        return this.session.windows.open(id, options);
    }

    write(id: string, text: string): void {
        this.session.windows.write(id, text);
    }

    clear(id: string): void {
        this.session.windows.clear(id);
    }

    setTitle(id: string, title?: string): boolean {
        return this.session.windows.setTitle(id, title);
    }

    focus(id: string): void {
        this.session.windows.focus(id);
    }

    hide(id: string): void {
        this.session.windows.hide(id);
    }

    show(id: string): boolean {
        return this.session.windows.show(id);
    }

    close(id: string): void {
        this.session.windows.close(id);
    }

    has(id: string): boolean {
        return this.session.windows.has(id);
    }

    isVisible(id: string): boolean {
        return this.session.windows.isVisible(id);
    }

    isMiniConsole(id: string): boolean {
        return this.session.windows.isMiniConsole(id);
    }

    move(id: string, x: number, y: number): void {
        this.session.windows.setPosition(id, x, y);
    }

    bringToFront(id: string): void {
        this.session.windows.bringToFront(id);
    }

    sendToBack(id: string): void {
        this.session.windows.sendToBack(id);
    }

    resize(id: string, width: number, height: number): void {
        this.session.windows.setSize(id, width, height);
    }

    setFontSize(id: string, size: number): boolean {
        return this.session.windows.setFontSize(id, size);
    }

    getFontSize(id: string): number | null {
        return this.session.windows.getFontSize(id);
    }

    setFont(id: string, family: string): boolean {
        return this.session.windows.setFont(id, family);
    }

    getFont(id: string): string | null {
        return this.session.windows.getFont(id);
    }

    setBackgroundColor(id: string, r: number, g: number, b: number, a = 255): boolean {
        return this.session.windows.setBackgroundColor(id, r, g, b, a);
    }

    getBackgroundColor(id: string): { r: number; g: number; b: number; a: number } | null {
        return this.session.windows.getBackgroundColor(id);
    }

    element(id: string): HTMLElement | null {
        return this.session.windows.getElement(id);
    }

    // ── Per-window command line ────────────────────────────────
    enableCommandLine(id: string): boolean {
        return this.session.windows.enableCommandLine(id);
    }
    disableCommandLine(id: string): boolean {
        return this.session.windows.disableCommandLine(id);
    }
    setCmdLineStyleSheet(id: string, css: string): boolean {
        return this.session.windows.setCmdLineStyleSheet(id, css);
    }
    setCmdLineAction(id: string, cb: ((text: string) => void) | null): boolean {
        return this.session.windows.setCmdLineAction(id, cb);
    }
    clearCmdLine(id: string): boolean {
        return this.session.windows.clearWindowCmdLine(id);
    }
    printCmdLine(id: string, text: string): boolean {
        return this.session.windows.printWindowCmdLine(id, text);
    }
    appendCmdLine(id: string, text: string): boolean {
        return this.session.windows.appendWindowCmdLine(id, text);
    }
    getCmdLineValue(id: string): string {
        return this.session.windows.getCmdLineValue(id);
    }
}

// ── Labels ────────────────────────────────────────────────────────────────────

class ScriptingLabelsAPI {
    constructor(
        private readonly manager: LabelManager,
        private readonly cssRewriter: () => ((css: string) => string) | null,
    ) {}

    create(name: string, opts: LabelCreateOptions): boolean {
        return this.manager.create(name, opts);
    }
    has(name: string): boolean { return this.manager.has(name); }
    destroy(name: string): boolean { return this.manager.destroy(name); }
    move(name: string, x: number, y: number): boolean {
        return this.manager.move(name, x, y);
    }
    resize(name: string, width: number, height: number): boolean {
        return this.manager.resize(name, width, height);
    }
    show(name: string): boolean { return this.manager.show(name); }
    hide(name: string): boolean { return this.manager.hide(name); }
    setHtml(name: string, html: string): boolean {
        return this.manager.setHtml(name, html);
    }
    setBackgroundColor(name: string, r: number, g: number, b: number, a = 255): boolean {
        return this.manager.setBackgroundColor(name, r, g, b, a);
    }
    getBackgroundColor(name: string): { r: number; g: number; b: number; a: number } | null {
        return this.manager.getBackgroundColor(name);
    }
    setStyleSheet(name: string, css: string): boolean {
        const rewrite = this.cssRewriter();
        return this.manager.setStyleSheet(name, rewrite ? rewrite(css) : css);
    }
    getStyleSheet(name: string): string | undefined {
        return this.manager.getStyleSheet(name);
    }
    getSizeHint(name: string): { width: number; height: number } | null {
        return this.manager.getSizeHint(name);
    }
    setClickCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setClickCallback(name, fn);
    }
    setMouseUpCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseUpCallback(name, fn);
    }
    setDoubleClickCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setDoubleClickCallback(name, fn);
    }
    setMouseMoveCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseMoveCallback(name, fn);
    }
    setMouseEnterCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseEnterCallback(name, fn);
    }
    setMouseLeaveCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseLeaveCallback(name, fn);
    }
    setWheelCallback(name: string, fn: ((e: LabelWheelEvent) => void) | undefined): boolean {
        return this.manager.setWheelCallback(name, fn);
    }
    setTooltip(name: string, text: string | undefined): boolean {
        return this.manager.setTooltip(name, text);
    }
    setClickThrough(name: string, value: boolean): boolean {
        return this.manager.setClickThrough(name, value);
    }
    setCursor(name: string, cursor: string | undefined): boolean {
        return this.manager.setCursor(name, cursor);
    }
    raise(name: string): boolean { return this.manager.raise(name); }
    lower(name: string): boolean { return this.manager.lower(name); }
}

// ── Main API ──────────────────────────────────────────────────────────────────

export class ScriptingAPI {
    readonly windows: ScriptingWindowsAPI;
    readonly labels: ScriptingLabelsAPI;
    readonly aliases: AliasEngine;
    readonly triggers: TriggerEngine;
    profileName = '';
    readonly timers: TimerEngine;
    readonly keys: KeyEngine;
    /** Mudlet-compatible stopwatch registry (createStopWatch & friends).
     *  Persistent watches survive reloads via localStorage keyed by connection. */
    readonly stopwatches: StopwatchManager;

    private readonly mainConsole = new Console();

    // True while the trigger pipeline is running for the current line. Drives
    // echo deferral and rerender suppression — Mudlet's TLuaInterpreter has no
    // analogous flag (the renderer reads the buffer at paint time), but mudix
    // renders via 'message' events, so we have to suppress per-mutation
    // rerenders during trigger processing and let the post-trigger render
    // pick up the final state in one shot.
    private inTriggerProcessing = false;

    // While lineBuffer is active, echo/cecho output is held here and flushed
    // to the output *after* the triggering line (or batch) is rendered.
    private echoDeferred: AnsiAwareBuffer[] = [];
    private isDeferringEcho = false;

    // Callback set by ScriptingEngine so link clicks can execute Lua code.
    private executeScript: ((code: string) => void) | null = null;

    // Callback set by ScriptingEngine to route expandAlias through the full pipeline.
    private expandAliasCallback: ((text: string, echo: boolean) => void) | null = null;

    // Callback set by ScriptingEngine. Raises sysDataSendRequest and reports
    // whether a handler called denyCurrentSend().
    private sendRequestDispatcher: ((text: string) => boolean) | null = null;

    // Callback set by ScriptingEngine. Runs a synthetic flushLines batch
    // through the same pipeline as network-driven flushLines so feedTriggers
    // shares ordering semantics.
    private feedDispatcher: ((groups: { text: string; type: string }[]) => void) | null = null;

    // Callbacks set by ScriptingEngine. Wire installPackage / uninstallPackage
    // through to the engine so the package's items reach the appStore (and
    // thus the runtime) and sysInstall* / sysUninstall* events fire in order.
    private packageInstaller: ((path: string) => boolean) | null = null;
    private packageUninstaller: ((name: string) => boolean) | null = null;
    private packagesGetter: (() => string[]) | null = null;
    private moduleInstaller: ((path: string) => boolean) | null = null;
    private moduleUninstaller: ((name: string) => boolean) | null = null;
    private moduleSyncer: ((name: string) => Promise<void>) | null = null;
    private moduleReloader: ((name: string) => boolean) | null = null;
    private moduleSyncSetter: ((name: string, sync: boolean) => void) | null = null;
    private moduleSyncGetter: ((name: string) => boolean) | null = null;
    private modulePrioritySetter: ((name: string, priority: number) => boolean) | null = null;
    private modulePriorityGetter: ((name: string) => number) | null = null;
    private modulesGetter: (() => string[]) | null = null;
    private moduleInfoGetter: ((name: string) => Record<string, unknown> | null) | null = null;
    private cssRewriter: ((css: string) => string) | null = null;
    private scriptToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private triggerToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private triggerStayOpenSetter: ((name: string, lines: number) => boolean) | null = null;
    private timerToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private aliasToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private keyToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private existsCallback: ((nameOrId: string | number, type: string) => number) | null = null;
    private isActiveCallback: ((nameOrId: string | number, type: string, checkAncestors: boolean) => number) | null = null;
    // Mudlet returns a numeric script id from permScript/permRegexTrigger/setScript;
    // -1 signals failure (missing parent group, unknown script name, etc.).
    private permScriptCallback: ((name: string, parent: string, code: string) => number) | null = null;
    private permRegexTriggerCallback: ((name: string, parent: string, regexes: string[], code: string) => number) | null = null;
    private permSubstringTriggerCallback: ((name: string, parent: string, patterns: string[], code: string) => number) | null = null;
    private permAliasCallback: ((name: string, parent: string, pattern: string, code: string) => number) | null = null;
    private permTimerCallback: ((name: string, parent: string, delay: number, code: string) => number) | null = null;
    // Mudlet permKey(name, parent, modifier, key, code). Modifier comes from the
    // engine as a Qt::KeyboardModifier int; the JS-side resolver translates it
    // back into `["ctrl",...]` strings to store on the KeyNode.
    private permKeyCallback: ((name: string, parent: string, modifier: number, key: string, code: string) => number) | null = null;
    // Mudlet button & toolbar APIs operate on ButtonNodes stored in the same
    // tree the persistent button bar consumes — these callbacks let the
    // ScriptingEngine carry the mutation while ScriptingAPI keeps the Lua
    // surface area in one place.
    private tempButtonCallback: ((toolbar: string, name: string, code: string, orientation: number) => number) | null = null;
    private tempButtonToolbarCallback: ((name: string, orientation: number, location: number) => number) | null = null;
    private buttonStateSetter: ((name: string, state: boolean) => boolean) | null = null;
    private buttonStateGetter: ((name: string) => boolean | null) | null = null;
    private buttonStyleSheetSetter: ((name: string, css: string) => boolean) | null = null;
    private toolBarToggler: ((name: string, show: boolean) => boolean) | null = null;
    /** Mudlet `startLogging(state)`. Forwarded to ProfileSession, which owns
     *  the SessionLogger instance (created/torn-down on this hook). */
    private loggingToggler: ((enabled: boolean) => boolean) | null = null;
    private setScriptCallback: ((name: string, code: string, pos: number) => number) | null = null;
    // Mudlet's killTimer/killAlias/killTrigger/killKey accept the name of a
    // permanent item in addition to the numeric id of a temp one. The engine
    // wires these to remove the matching store nodes.
    private killByNameCallback: ((kind: 'timer' | 'alias' | 'trigger' | 'key', name: string) => boolean) | null = null;

    private selection: { windowName: string | undefined; start: number; length: number } | null = null;

    // Session-global rich-text clipboard — mirrors Mudlet's host-wide
    // mClipboard. `copy()` fills it from the current selection (formatting
    // preserved); `paste()`/`appendBuffer()` read from it.
    private clipboard: AnsiAwareBuffer | null = null;

    // Names of off-screen text buffers created via `createBuffer`. Their
    // backing Console lives in `session.consoles` like any window console, but
    // has no panel — so output to them is never pushed to the WindowManager
    // (which would force a panel open). See `drainWindowConsole`.
    private buffers = new Set<string>();

    constructor(
        private readonly session: MudSession,
        aliasEngine: AliasEngine,
        triggerEngine: TriggerEngine,
        timerEngine: TimerEngine,
        keyEngine: KeyEngine,
        private readonly connectionId: string,
    ) {
        this.windows = new ScriptingWindowsAPI(session);
        this.labels = new ScriptingLabelsAPI(session.labels, () => this.cssRewriter);
        this.aliases = aliasEngine;
        this.triggers = triggerEngine;
        this.timers = timerEngine;
        this.keys = keyEngine;
        this.stopwatches = new StopwatchManager(localStorageStopwatchStore(connectionId));
        session.consoles.set('main', this.mainConsole);
        // Mudlet `sysBufferShrinkEvent("main", linesRemoved)` — named user
        // windows have the same hook wired in WindowManager.registerConsole.
        this.mainConsole.onBufferShrink = (n) => this.eventRaiser?.('sysBufferShrinkEvent', ['main', n]);
    }

    // ── Connection ────────────────────────────────────────────────────────────

    connect(url: string): void {
        this.session.connect(url);
    }

    disconnect(): void {
        this.session.disconnect();
    }

    send(text: string, echo = true): void {
        // sysDataSendRequest handlers may deny the send. If no dispatcher is
        // wired yet (early init), send straight.
        if (this.sendRequestDispatcher && this.sendRequestDispatcher(text)) return;
        this.session.send(text, echo);
    }

    sendGmcp(message: string): void {
        this.session.sendGmcpRaw(message);
    }

    /** Mudlet `sendMSDP(variable, ...values)`. Frames an MSDP subnegotiation
     *  (`IAC SB MSDP MSDP_VAR <var> [MSDP_VAL <val>]... IAC SE`) and sends it. */
    sendMSDP(variable: string, values: string[]): boolean {
        return this.session.sendMSDP(variable, values);
    }

    /** Mudlet `sendSocket(data)`. Sends a literal byte-string over the socket
     *  with no telnet/encoding processing (each char is one byte). */
    sendSocket(data: string): boolean {
        return this.session.sendSocket(data);
    }

    /** Mudlet `feedTelnet(data)`. Injects raw server bytes into the inbound
     *  pipeline as if received from the MUD (telnet stripping → ANSI →
     *  triggers → render). */
    feedTelnet(data: string): void {
        this.session.feedTelnet(data);
    }

    setSendRequestDispatcher(fn: ((text: string) => boolean) | null): void {
        this.sendRequestDispatcher = fn;
    }

    setFeedDispatcher(fn: ((groups: { text: string; type: string }[]) => void) | null): void {
        this.feedDispatcher = fn;
    }

    setPackageInstaller(fn: ((path: string) => boolean) | null): void {
        this.packageInstaller = fn;
    }

    setPackageUninstaller(fn: ((name: string) => boolean) | null): void {
        this.packageUninstaller = fn;
    }

    setPackagesGetter(fn: (() => string[]) | null): void {
        this.packagesGetter = fn;
    }

    getPackages(): string[] {
        return this.packagesGetter?.() ?? [];
    }

    setModuleInstaller(fn: ((path: string) => boolean) | null): void { this.moduleInstaller = fn; }
    setModuleUninstaller(fn: ((name: string) => boolean) | null): void { this.moduleUninstaller = fn; }
    setModuleSyncer(fn: ((name: string) => Promise<void>) | null): void { this.moduleSyncer = fn; }
    setModuleReloader(fn: ((name: string) => boolean) | null): void { this.moduleReloader = fn; }
    setModuleSyncSetter(fn: ((name: string, sync: boolean) => void) | null): void { this.moduleSyncSetter = fn; }
    setModuleSyncGetter(fn: ((name: string) => boolean) | null): void { this.moduleSyncGetter = fn; }
    setModulePrioritySetter(fn: ((name: string, priority: number) => boolean) | null): void { this.modulePrioritySetter = fn; }
    setModulePriorityGetter(fn: ((name: string) => number) | null): void { this.modulePriorityGetter = fn; }
    setModulesGetter(fn: (() => string[]) | null): void { this.modulesGetter = fn; }
    setModuleInfoGetter(fn: ((name: string) => Record<string, unknown> | null) | null): void { this.moduleInfoGetter = fn; }

    installModule(path: string): boolean { return this.moduleInstaller?.(path) ?? false; }
    uninstallModule(name: string): boolean { return this.moduleUninstaller?.(name) ?? false; }
    syncModule(name: string): Promise<void> { return this.moduleSyncer?.(name) ?? Promise.resolve(); }
    reloadModule(name: string): boolean { return this.moduleReloader?.(name) ?? false; }
    enableModuleSync(name: string): void { this.moduleSyncSetter?.(name, true); }
    disableModuleSync(name: string): void { this.moduleSyncSetter?.(name, false); }
    getModuleSync(name: string): boolean { return this.moduleSyncGetter?.(name) ?? false; }
    setModulePriority(name: string, priority: number): boolean {
        return this.modulePrioritySetter?.(name, priority) ?? false;
    }
    getModulePriority(name: string): number { return this.modulePriorityGetter?.(name) ?? 0; }
    getModules(): string[] { return this.modulesGetter?.() ?? []; }
    getModuleInfo(name: string): Record<string, unknown> | null { return this.moduleInfoGetter?.(name) ?? null; }

    setScriptToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.scriptToggler = fn;
    }

    setTriggerToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.triggerToggler = fn;
    }

    setTriggerStayOpenSetter(fn: ((name: string, lines: number) => boolean) | null): void {
        this.triggerStayOpenSetter = fn;
    }

    /**
     * Mudlet `setTriggerStayOpen(name, lines)`. Keeps the named trigger's chain
     * open for `lines` more lines of input for the current run only — it adjusts
     * transient chain state, not the persisted trigger's fire-length. 0 closes
     * the chain after the current line; positive values extend or shorten an
     * already-running chain.
     */
    setTriggerStayOpen(name: string, lines: number): boolean {
        return this.triggerStayOpenSetter?.(name, lines) ?? false;
    }

    setTimerToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.timerToggler = fn;
    }

    setAliasToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.aliasToggler = fn;
    }

    setKeyToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.keyToggler = fn;
    }

    setExistsCallback(fn: ((nameOrId: string | number, type: string) => number) | null): void {
        this.existsCallback = fn;
    }

    setIsActiveCallback(fn: ((nameOrId: string | number, type: string, checkAncestors: boolean) => number) | null): void {
        this.isActiveCallback = fn;
    }

    setPermScriptCallback(fn: ((name: string, parent: string, code: string) => number) | null): void {
        this.permScriptCallback = fn;
    }

    setPermRegexTriggerCallback(fn: ((name: string, parent: string, regexes: string[], code: string) => number) | null): void {
        this.permRegexTriggerCallback = fn;
    }

    setPermSubstringTriggerCallback(fn: ((name: string, parent: string, patterns: string[], code: string) => number) | null): void {
        this.permSubstringTriggerCallback = fn;
    }

    setPermAliasCallback(fn: ((name: string, parent: string, pattern: string, code: string) => number) | null): void {
        this.permAliasCallback = fn;
    }

    setPermTimerCallback(fn: ((name: string, parent: string, delay: number, code: string) => number) | null): void {
        this.permTimerCallback = fn;
    }

    setPermKeyCallback(fn: ((name: string, parent: string, modifier: number, key: string, code: string) => number) | null): void {
        this.permKeyCallback = fn;
    }

    setTempButtonCallback(fn: ((toolbar: string, name: string, code: string, orientation: number) => number) | null): void {
        this.tempButtonCallback = fn;
    }

    setTempButtonToolbarCallback(fn: ((name: string, orientation: number, location: number) => number) | null): void {
        this.tempButtonToolbarCallback = fn;
    }

    setButtonStateSetter(fn: ((name: string, state: boolean) => boolean) | null): void {
        this.buttonStateSetter = fn;
    }

    setButtonStateGetter(fn: ((name: string) => boolean | null) | null): void {
        this.buttonStateGetter = fn;
    }

    setButtonStyleSheetSetter(fn: ((name: string, css: string) => boolean) | null): void {
        this.buttonStyleSheetSetter = fn;
    }

    setToolBarToggler(fn: ((name: string, show: boolean) => boolean) | null): void {
        this.toolBarToggler = fn;
    }

    setSetScriptCallback(fn: ((name: string, code: string, pos: number) => number) | null): void {
        this.setScriptCallback = fn;
    }

    /** Hook for ProfileSession to start/stop the per-connection SessionLogger.
     *  Mudlet `startLogging(true|false)` toggles whether new output lines are
     *  recorded; the on/off transition is synchronous. */
    setLoggingToggler(fn: ((enabled: boolean) => boolean) | null): void {
        this.loggingToggler = fn;
    }

    /** Mudlet `startLogging(state)`. Returns true on success, false when
     *  the toggle isn't wired up yet (e.g. before ProfileSession mounts). */
    startLogging(enabled: boolean): boolean {
        return this.loggingToggler?.(enabled) ?? false;
    }

    setKillByNameCallback(fn: ((kind: 'timer' | 'alias' | 'trigger' | 'key', name: string) => boolean) | null): void {
        this.killByNameCallback = fn;
    }

    killByName(kind: 'timer' | 'alias' | 'trigger' | 'key', name: string): boolean {
        return this.killByNameCallback?.(kind, name) ?? false;
    }

    setCssRewriter(fn: ((css: string) => string) | null): void {
        this.cssRewriter = fn;
    }

    installPackage(path: string): boolean {
        return this.packageInstaller?.(path) ?? false;
    }

    uninstallPackage(name: string): boolean {
        return this.packageUninstaller?.(name) ?? false;
    }

    enableScript(name: string): boolean {
        return this.scriptToggler?.(name, true) ?? false;
    }

    disableScript(name: string): boolean {
        return this.scriptToggler?.(name, false) ?? false;
    }

    enableTrigger(name: string): boolean {
        return this.triggerToggler?.(name, true) ?? false;
    }

    disableTrigger(name: string): boolean {
        return this.triggerToggler?.(name, false) ?? false;
    }

    enableTimer(name: string): boolean {
        return this.timerToggler?.(name, true) ?? false;
    }

    disableTimer(name: string): boolean {
        return this.timerToggler?.(name, false) ?? false;
    }

    enableAlias(name: string): boolean {
        return this.aliasToggler?.(name, true) ?? false;
    }

    disableAlias(name: string): boolean {
        return this.aliasToggler?.(name, false) ?? false;
    }

    enableKey(name: string): boolean {
        return this.keyToggler?.(name, true) ?? false;
    }

    disableKey(name: string): boolean {
        return this.keyToggler?.(name, false) ?? false;
    }

    /**
     * Mudlet `getOS()` — the platform name scripts branch on. Mudlet returns
     * the native OS ("windows"/"mac"/"linux"/…); in the browser we report the
     * underlying OS sniffed from the user agent so platform-specific scripts
     * (e.g. mac vs. windows keybinding hints, the bundled accessibility
     * stylesheet) behave sensibly. "unknown" when it can't be determined.
     */
    getOS(): string {
        if (typeof navigator === 'undefined') return 'unknown';
        const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
        const raw = (nav.userAgentData?.platform || nav.platform || nav.userAgent || '').toLowerCase();
        if (raw.includes('win')) return 'windows';
        if (raw.includes('mac') || raw.includes('iphone') || raw.includes('ipad') || raw.includes('ios')) return 'mac';
        if (raw.includes('android') || raw.includes('linux') || raw.includes('cros')) return 'linux';
        if (raw.includes('freebsd')) return 'freebsd';
        if (raw.includes('openbsd')) return 'openbsd';
        if (raw.includes('netbsd')) return 'netbsd';
        return 'unknown';
    }

    /**
     * Mudlet `getWindowsCodepage()` — on native Windows this reads the active
     * ANSI code page (ACP) from the registry as a string; the bundled
     * utf8_filenames.lua consults it (when getOS() == "windows") to decide
     * whether to transcode filenames from UTF-8 to a legacy ANSI page. The
     * browser VFS is always UTF-8, whose code page number is 65001, so we report
     * that on every platform. utf8_filenames keys its mapping table by legacy
     * ANSI page numbers (1250/1252/932/…), none of which is 65001 — so reporting
     * 65001 makes it correctly skip transcoding rather than corrupt UTF-8 paths.
     */
    getWindowsCodepage(): string {
        return '65001';
    }

    exists(nameOrId: string | number, type: string): number {
        return this.existsCallback?.(nameOrId, type) ?? 0;
    }

    /**
     * Mudlet `isActive(name|id, type [, checkAncestors])` — count of *active*
     * items matching the name (or 1/0 for an id). An item is active when its own
     * enabled flag is set; with `checkAncestors` (default false) every ancestor
     * group must be enabled too. Type strings mirror `exists`.
     */
    isActive(nameOrId: string | number, type: string, checkAncestors = false): number {
        return this.isActiveCallback?.(nameOrId, type, checkAncestors) ?? 0;
    }

    permScript(name: string, parent: string, code: string): number {
        return this.permScriptCallback?.(name, parent, code) ?? -1;
    }

    permRegexTrigger(name: string, parent: string, regexes: string[], code: string): number {
        return this.permRegexTriggerCallback?.(name, parent, regexes, code) ?? -1;
    }

    /** Mudlet `permSubstringTrigger(name, parent, patterns, luaCode)`. Same
     *  shape as permRegexTrigger but each pattern uses substring matching
     *  (`String.prototype.includes` semantics, like the temp variant). An
     *  empty patterns array creates a trigger group. Returns the new id, or
     *  -1 if `parent` is given but no trigger group of that name exists. */
    permSubstringTrigger(name: string, parent: string, patterns: string[], code: string): number {
        return this.permSubstringTriggerCallback?.(name, parent, patterns, code) ?? -1;
    }

    /** Mudlet `permAlias(name, parent, regex, luaCode)`. Creates a persistent
     *  alias under the named parent group (empty = root). Returns the new
     *  alias id, or -1 when `parent` is non-empty but no alias group of that
     *  name exists. */
    permAlias(name: string, parent: string, pattern: string, code: string): number {
        return this.permAliasCallback?.(name, parent, pattern, code) ?? -1;
    }

    /** Mudlet `permTimer(name, parent, seconds, luaCode)`. Creates a
     *  persistent one-shot timer under the parent group (empty = root).
     *  Returns the new timer id, or -1 when `parent` is non-empty but no
     *  timer group of that name exists. */
    permTimer(name: string, parent: string, delay: number, code: string): number {
        return this.permTimerCallback?.(name, parent, delay, code) ?? -1;
    }

    /** Mudlet `permKey(name, parent, modifier, keycode, luaCode)`. Persists a
     *  keybinding under the named parent group (empty = root). Returns the new
     *  id, or -1 when `parent` is non-empty but no key group of that name
     *  exists. `modifier` is the Qt keyboard-modifier int (1=shift, 2=ctrl,
     *  4=alt, 8=meta) — -1 means "no modifier" (Mudlet's convention; used by
     *  `permGroup("name","key")`). */
    permKey(name: string, parent: string, modifier: number, key: string, code: string): number {
        return this.permKeyCallback?.(name, parent, modifier, key, code) ?? -1;
    }

    /** Mudlet `tempButton(toolbarName, name, code [, orientation])`. Appends a
     *  transient button under an existing toolbar group; returns the new id, or
     *  -1 when the toolbar doesn't exist. `orientation` is Mudlet's int form
     *  (0=horizontal/1=vertical) — accepted for compat, applied to the
     *  button row inside the toolbar grid. */
    tempButton(toolbar: string, name: string, code: string, orientation: number): number {
        return this.tempButtonCallback?.(toolbar, name, code, orientation) ?? -1;
    }

    /** Mudlet `tempButtonToolbar(name [, orientation [, location]])`. Creates
     *  a transient toolbar (ButtonNode group). `location` int: 0=top, 1=bottom,
     *  2=left, 3=right, 4=floating. Returns the new id or -1 on duplicate
     *  name. */
    tempButtonToolbar(name: string, orientation: number, location: number): number {
        return this.tempButtonToolbarCallback?.(name, orientation, location) ?? -1;
    }

    /** Mudlet `setButtonState(name, state)`. Sets the pressed state of a
     *  two-state (push-down) button by name. Returns false when not found. */
    setButtonState(name: string, state: boolean): boolean {
        return this.buttonStateSetter?.(name, state) ?? false;
    }

    /** Mudlet `getButtonState(name)`. Reads the pressed state of a two-state
     *  button. Returns nil when not found. */
    getButtonState(name: string): boolean | null {
        return this.buttonStateGetter?.(name) ?? null;
    }

    /** Mudlet `setButtonStyleSheet(name, css)`. Stores a CSS string on the
     *  ButtonNode; the renderer applies it inline. Returns false when not
     *  found. */
    setButtonStyleSheet(name: string, css: string): boolean {
        return this.buttonStyleSheetSetter?.(name, css) ?? false;
    }

    /** Mudlet `showToolBar(name)` / `hideToolBar(name)`. Toggles the toolbar's
     *  effective enabled flag — the existing button bar already gates render
     *  on `isEffectivelyEnabled`, so flipping the group's `enabled` field is
     *  the show/hide hook. Returns true on success, false when not found. */
    setToolBarVisibility(name: string, show: boolean): boolean {
        return this.toolBarToggler?.(name, show) ?? false;
    }

    setScript(name: string, code: string, pos: number): number {
        return this.setScriptCallback?.(name, code, pos) ?? -1;
    }

    // ── Echo / output ─────────────────────────────────────────────────────────

    echo(text: string): void {
        this.mainConsole.echo(text);
        this.drainMain();
    }

    echoToWindow(win: string, text: string): void {
        const con = this.outputConsole(win);
        con.echo(text);
        this.drainWindowConsole(win, con);
    }

    /**
     * Mudlet `echoLink([win,] text, cmd, hint, [useCurrentFormat])`. With
     * `useCurrentFormat=false` (the default), the link is rendered with
     * Mudlet's built-in style: blue foreground + underline. With
     * `useCurrentFormat=true`, the current pen state on the resolved console
     * is preserved.
     */
    echoLink(text: string, cmd: string, tooltip: string, win?: string, useCurrentFormat = false): void {
        if (!text) return;  // xEcho emits empty-text calls for colour-only segments
        const hyperlink: FormatHyperlink = {
            onClick: () => { this.executeScript?.(cmd); },
            title: tooltip || undefined,
        };
        const con = this.outputConsole(win);
        con.format.hyperlink = hyperlink;
        if (!useCurrentFormat) {
            // Mudlet's TConsole::echoLink default: blue + underline.
            const prevFg = con.format.foreground;
            const prevUnderline = con.format.underline;
            con.format.foreground = { space: 'rgb', r: 0, g: 0, b: 255 };
            con.format.underline = true;
            con.echo(text);
            con.format.foreground = prevFg;
            con.format.underline = prevUnderline;
        } else {
            con.echo(text);
        }
        con.format.hyperlink = undefined;
        if (!win || win === 'main') {
            this.drainMain();
        } else {
            this.drainWindowConsole(win, con);
        }
    }

    /**
     * Build a {@link FormatHyperlink} whose right-click handler opens a context
     * menu listing `cmds` (labelled by `hints`, falling back to the command
     * text). Shared by `echoPopup`/`insertPopup`/`setPopup` — those three differ
     * only in whether the styled span is appended, inserted at the cursor, or
     * applied to the current selection.
     */
    private buildPopupHyperlink(cmds: string[], hints: string[]): FormatHyperlink {
        const onContextMenu = (ev: MouseEvent) => {
            ev.preventDefault();
            document.getElementById('mudix-popup-menu')?.remove();

            const menu = document.createElement('div');
            menu.id = 'mudix-popup-menu';
            menu.style.cssText = 'position:fixed;z-index:9999;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:2px 0;box-shadow:0 2px 10px rgba(0,0,0,0.7);min-width:120px;font-family:monospace;font-size:13px';
            menu.style.left = `${ev.clientX}px`;
            menu.style.top = `${ev.clientY}px`;

            cmds.forEach((cmd, i) => {
                const item = document.createElement('div');
                item.textContent = hints[i] ?? cmd;
                item.style.cssText = 'padding:5px 14px;cursor:pointer;color:#ddd;white-space:nowrap';
                item.addEventListener('mouseenter', () => { item.style.background = '#2a4a6e'; });
                item.addEventListener('mouseleave', () => { item.style.background = ''; });
                item.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    menu.remove();
                    this.executeScript?.(cmd);
                });
                menu.appendChild(item);
            });

            document.body.appendChild(menu);

            const dismiss = (e: MouseEvent) => {
                if (!menu.contains(e.target as Node)) {
                    menu.remove();
                    document.removeEventListener('mousedown', dismiss);
                }
            };
            setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
        };

        return { onContextMenu, title: hints[0] ?? '' };
    }

    echoPopup(text: string, cmds: string[], hints: string[], win?: string): void {
        const con = this.outputConsole(win);
        con.format.hyperlink = this.buildPopupHyperlink(cmds, hints);
        con.echo(text);
        con.format.hyperlink = undefined;
        if (!win || win === 'main') {
            this.drainMain();
        } else {
            this.drainWindowConsole(win, con);
        }
    }

    /**
     * Mudlet `insertPopup([window,] text, {commands}, {hints})`. Like
     * `insertText`/`insertLink`, but the inserted span carries a right-click
     * popup menu of `cmds`. Inserts at the cursor on the current line and
     * preserves the surrounding pen state; degrades to `echoPopup` when no
     * backing buffer is available (empty console / sub-window without a buffer).
     */
    insertPopup(text: string, cmds: string[], hints: string[], win?: string): void {
        if (!text) return;
        const con = this.getConsole(win);
        const buf = con?.getBuffer();
        if (con && buf) {
            const state: FormatStateSnapshot = con.format.toSnapshot();
            state.hyperlink = this.buildPopupHyperlink(cmds, hints);
            const at = Math.max(0, Math.min(con.getCursorColumn(), buf.text.length));
            buf.insert(at, text, state);
            if (!this.inTriggerProcessing) buf.rerender();
            return;
        }
        this.echoPopup(text, cmds, hints, win);
    }

    /**
     * Mudlet `setPopup([window,] {commands}, {hints})`. Attaches a right-click
     * popup menu to the current selection — preserves the selection's existing
     * colors/attributes (like `setLink`, unlike the homogenizing color setters).
     * `commands` are Lua code strings run when the matching menu entry is
     * chosen. Returns false when there is no selection (or it belongs to a
     * different window).
     */
    setPopup(cmds: string[], hints: string[], win?: string): boolean {
        if (!this.selection) return false;
        if (win !== undefined && !this.selectionMatches(win)) return false;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return false;
        buf.setHyperlink([sel.start, sel.start + sel.length], this.buildPopupHyperlink(cmds, hints));
        if (!this.inTriggerProcessing) buf.rerender();
        return true;
    }

    setExecuteScript(fn: ((code: string) => void) | null): void {
        this.executeScript = fn;
    }

    setExpandAlias(fn: ((text: string, echo: boolean) => void) | null): void {
        this.expandAliasCallback = fn;
    }

    expandAlias(text: string, echo: boolean): void {
        if (this.expandAliasCallback) {
            this.expandAliasCallback(text, echo);
        } else {
            this.send(text, echo);
        }
    }

    // ── Format state ──────────────────────────────────────────────────────────
    // Mirrors Mudlet's TConsole::setFgColor/setBgColor/setDisplayAttributes:
    // every call applies the format to the active selection (if any) AND sets
    // the current pen on the resolved console for subsequent echo.

    setFgColor(r: number, g: number, b: number, win?: string): void {
        if (this.selectionMatches(win)) {
            this.applyStateToSelection({ foreground: { space: 'rgb', r, g, b } });
        }
        this.outputConsole(win).setFgColor(r, g, b);
    }

    setBgColor(r: number, g: number, b: number, a?: number, win?: string): void {
        const color: RgbColor = a !== undefined && a < 255
            ? { space: 'rgb', r, g, b, a }
            : { space: 'rgb', r, g, b };
        if (this.selectionMatches(win)) {
            this.applyStateToSelection({ background: color });
        }
        this.outputConsole(win).setBgColor(r, g, b, a);
    }

    setBold(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ bold: v });
        this.outputConsole(win).setBold(v);
    }
    setItalic(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ italic: v });
        this.outputConsole(win).setItalic(v);
    }
    setUnderline(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ underline: v });
        this.outputConsole(win).setUnderline(v);
    }
    setStrikethrough(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ strikethrough: v });
        this.outputConsole(win).setStrikethrough(v);
    }
    /**
     * Mudlet `setReverse([window,] bool)`. Toggles reverse-video — the renderer
     * swaps the fg/bg pair when `inverse` is set (see Console rendering). Mirrors
     * the other style setters: applies to the active selection when one matches,
     * and updates the resolved console's pen for subsequent echo.
     */
    setReverse(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ inverse: v });
        this.outputConsole(win).setReverse(v);
    }

    /**
     * Mudlet `setTextFormat(windowName, r1, g1, b1, r2, g2, b2, bold, underline,
     * italics, [strikeout], [overline], [reverse], [blinkMode]) → bool`. Sets
     * the full pen state in one call. r1/g1/b1 is BACKGROUND, r2/g2/b2 is
     * FOREGROUND (a Mudlet quirk — preserved here for parity). `blinkMode` is
     * "none" / "slow" / "fast"; overline is accepted but a no-op (FormatState
     * has no overline channel). Returns false when the named window doesn't
     * resolve. Mirrors setFgColor & friends: the pen is updated on the resolved
     * console AND applied to the current selection when one is active on it.
     */
    setTextFormat(
        windowName: string | undefined,
        bg: { r: number; g: number; b: number },
        fg: { r: number; g: number; b: number },
        bold: boolean,
        underline: boolean,
        italics: boolean,
        strikeout: boolean,
        _overline: boolean,
        reverse: boolean,
        blinkMode: 'none' | 'slow' | 'fast',
    ): boolean {
        if (!this.consoleExists(windowName)) return false;

        const snapshot: FormatStateSnapshot = {
            foreground: { space: 'rgb', r: fg.r, g: fg.g, b: fg.b },
            background: { space: 'rgb', r: bg.r, g: bg.g, b: bg.b },
            bold: bold || undefined,
            italic: italics || undefined,
            underline: underline || undefined,
            strikethrough: strikeout || undefined,
            inverse: reverse || undefined,
            slowBlink: blinkMode === 'slow' || undefined,
            rapidBlink: blinkMode === 'fast' || undefined,
        };

        if (this.selectionMatches(windowName)) {
            this.applyStateToSelection(snapshot);
        }
        const con = this.outputConsole(windowName);
        con.format.foreground = snapshot.foreground;
        con.format.background = snapshot.background;
        con.format.bold = snapshot.bold;
        con.format.italic = snapshot.italic;
        con.format.underline = snapshot.underline;
        con.format.strikethrough = snapshot.strikethrough;
        con.format.inverse = snapshot.inverse;
        con.format.slowBlink = snapshot.slowBlink;
        con.format.rapidBlink = snapshot.rapidBlink;
        return true;
    }

    // ── Formatting (selection-aware) ──────────────────────────────────────────

    fg(name: string, win?: string): void {
        const state = namedColorToState(name, false);
        if (!state || state.foreground?.space !== 'rgb') return;
        const c = state.foreground;
        this.setFgColor(c.r, c.g, c.b, win);
    }

    bg(name: string, win?: string): void {
        const state = namedColorToState(name, true);
        if (!state || state.background?.space !== 'rgb') return;
        const c = state.background;
        this.setBgColor(c.r, c.g, c.b, undefined, win);
    }

    resetFormat(windowName?: string): void {
        // Mudlet TConsole::reset(): deselect + reset pen state to defaults.
        // It does NOT touch the buffer — selections lose their pointer here,
        // but characters keep whatever format was applied to them. Selection is
        // per-console in Mudlet, so only drop it when it belongs to this window
        // (mirrors `deselect`): echoing to one window — e.g. cecho/decho/hecho,
        // which call resetFormat internally — must not clear a selection made
        // in another, which would break selectCurrentLine(buf) → copy(buf) when
        // unrelated output goes to main in between.
        if (this.selectionMatches(windowName)) this.selection = null;
        this.outputConsole(windowName).resetFormat();
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    selectString(str: string, occurrence: number, windowName?: string): number {
        // Mudlet searches the cursor's current line. With Console as the
        // canonical buffer that is just `Console.getLine()` — including the
        // matching line during trigger processing (just appended) and any
        // history line the cursor was moved to.
        const line = this.getConsole(windowName)?.getLine() ?? '';

        let count = 0;
        let searchFrom = 0;
        while (searchFrom <= line.length - str.length) {
            const idx = line.indexOf(str, searchFrom);
            if (idx === -1) break;
            count++;
            if (count === occurrence) {
                this.selection = { windowName, start: idx, length: str.length };
                return idx;
            }
            searchFrom = idx + str.length;
        }
        return -1;
    }

    /**
     * Mudlet `selectSection([window,] from, length) → bool`. `from` is 0-indexed.
     * Negative `from` is rejected (Mudlet behavior); zero/negative lengths
     * register a no-op selection but still report success in Mudlet — we match
     * that, but reject when the resolved buffer doesn't exist.
     */
    selectSection(from: number, length: number, windowName?: string): boolean {
        if (!Number.isFinite(from) || from < 0) return false;
        if (!Number.isFinite(length) || length < 0) return false;
        const buf = this.resolveBuffer(windowName);
        if (!buf) return false;
        this.selection = { windowName, start: from, length };
        return true;
    }

    /**
     * Mudlet `selectCurrentLine([window])`. Selects the entire cursor line —
     * equivalent to `selectSection(0, #getCurrentLine())`. Returns false when
     * the named window doesn't exist; true otherwise (the main window always
     * exists, even with no history yet).
     */
    selectCurrentLine(windowName?: string): boolean {
        if (!this.consoleExists(windowName)) return false;
        const line = this.getConsole(windowName)?.getLine() ?? '';
        this.selection = { windowName, start: 0, length: line.length };
        return true;
    }

    /**
     * Mudlet `deselect([windowName])`. With a window name, only clears the
     * selection if it belongs to that window — selections in other consoles
     * remain intact. Without an arg, clears unconditionally.
     */
    deselect(windowName?: string): void {
        if (windowName !== undefined && !this.selectionMatches(windowName)) return;
        this.selection = null;
    }

    /**
     * Mudlet `getSelection([windowName])`. Returns the currently selected text
     * along with its 0-based start column and length on the active line. Returns
     * null when no selection is set, or when `windowName` is given and doesn't
     * match the selection's window — the Lua wrapper translates null into
     * Mudlet's `false, "no selection"` 2-tuple.
     */
    getSelection(windowName?: string): { text: string; start: number; length: number } | null {
        if (!this.selection) return null;
        if (windowName !== undefined && !this.selectionMatches(windowName)) return null;
        const buf = this.resolveBuffer(this.selection.windowName);
        if (!buf) return null;
        const { start, length } = this.selection;
        return { text: buf.text.slice(start, start + length), start, length };
    }

    /**
     * Mudlet `getFgColor([window])` / `getBgColor([window])`. Reads the fg/bg
     * color at the current selection's start position (Mudlet's P_begin). Each
     * console tracks its own selection in Mudlet; mudix has a single global
     * selection, so when `window` is given it must match the selection's
     * owning window — otherwise we treat it as "no selection in that window"
     * and return null (Mudlet's "no values" shape, surfaced as nil/nil/nil in
     * Lua via the Bridge wrapper).
     *
     * Mudlet returns 0 values when the cursor sits past the end of the line;
     * we mirror that for an empty buffer or a selection whose start is at/
     * past the buffer length. For valid positions where the segment carries
     * no explicit color, we resolve to the profile's default text/background
     * (matching Mudlet's behavior that every TChar carries baked-in colors).
     */
    getFgColor(windowName?: string): [number, number, number] | null {
        return this.readSelectionColor('foreground', windowName);
    }

    getBgColor(windowName?: string): [number, number, number] | null {
        return this.readSelectionColor('background', windowName);
    }

    private readSelectionColor(
        channel: 'foreground' | 'background',
        windowName: string | undefined,
    ): [number, number, number] | null {
        if (!this.selection) return null;
        if (!this.selectionMatches(windowName)) return null;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return null;
        if (sel.start < 0 || sel.start >= buf.length) return null;
        const state = buf.getStateAt(sel.start);
        const color = channel === 'foreground' ? state?.foreground : state?.background;
        const rgb = formatColorToRgb(color);
        if (rgb) return rgb;
        // No explicit color — resolve to the profile's configured default.
        if (channel === 'background') {
            const override = selectProfileField(useAppStore.getState(), this.connectionId, 'outputBackgroundColor');
            if (override) return [override.r, override.g, override.b];
            const themed = parseHexToRgb(selectProfileField(useAppStore.getState(), this.connectionId, 'outputBackground'));
            return themed ?? DEFAULT_BG_RGB;
        }
        const themed = parseHexToRgb(selectProfileField(useAppStore.getState(), this.connectionId, 'outputForeground'));
        return themed ?? DEFAULT_FG_RGB;
    }

    /**
     * Mudlet `getTextFormat([windowName]) → table | nil, errMsg`. Reads the full
     * set of display attributes of the character at the current selection's start
     * position (Mudlet's "char under cursor or selection"). Mirrors getFgColor /
     * getBgColor: requires an active selection that, when `windowName` is given,
     * belongs to that window, and whose start is within the buffer — otherwise
     * returns null (surfaced as nil + reason by the Bridge wrapper).
     *
     * `foreground`/`background` resolve through the same logic as getFgColor /
     * getBgColor (falling back to the profile defaults for unstyled segments).
     * `overline`, `concealed`, and `alternateFont` have no equivalent in mudix's
     * FormatState, so they report Mudlet's "off" values (false / 0) for parity.
     */
    getTextFormat(windowName?: string): {
        bold: boolean;
        italic: boolean;
        underline: boolean;
        strikeout: boolean;
        reverse: boolean;
        overline: boolean;
        concealed: boolean;
        alternateFont: number;
        blinking: 'none' | 'slow' | 'fast';
        foreground: [number, number, number];
        background: [number, number, number];
    } | null {
        if (!this.selection) return null;
        if (!this.selectionMatches(windowName)) return null;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return null;
        if (sel.start < 0 || sel.start >= buf.length) return null;
        const foreground = this.readSelectionColor('foreground', windowName);
        const background = this.readSelectionColor('background', windowName);
        if (!foreground || !background) return null;
        const state = buf.getStateAt(sel.start);
        return {
            bold: !!state?.bold,
            italic: !!state?.italic,
            underline: !!state?.underline,
            strikeout: !!state?.strikethrough,
            reverse: !!state?.inverse,
            overline: false,
            concealed: false,
            alternateFont: 0,
            blinking: state?.rapidBlink ? 'fast' : state?.slowBlink ? 'slow' : 'none',
            foreground,
            background,
        };
    }

    applyFormatToSelection(state: FormatStateSnapshot): void {
        this.applyStateToSelection(state);
    }

    /**
     * Mudlet `setLink([windowName], command, hint)`. Applies a clickable
     * hyperlink to the current selection — preserves existing colors/attributes
     * on each segment (unlike setFgColor & friends which homogenize). `command`
     * is the Lua code run on click; the Bridge.lua wrapper converts function
     * arguments into a `__mudix_call_link(id)` string before reaching here.
     * Returns false if there is no selection (or it doesn't belong to `win`).
     */
    setLink(cmd: string, tooltip: string, win?: string): boolean {
        if (!this.selection) return false;
        if (win !== undefined && !this.selectionMatches(win)) return false;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return false;
        const hyperlink: FormatHyperlink = {
            onClick: () => { this.executeScript?.(cmd); },
            title: tooltip || undefined,
        };
        buf.setHyperlink([sel.start, sel.start + sel.length], hyperlink);
        if (!this.inTriggerProcessing) buf.rerender();
        return true;
    }

    // ── Trigger pipeline hooks (called by ScriptingEngine) ────────────────────

    /**
     * Called before trigger processing for each incoming line. Pushes the
     * matching line into mainConsole.history so cursor-driven APIs see it as
     * a regular addressable line (Mudlet's TBuffer holds the matching line
     * during trigger processing — the cursor is just an (x,y) into that
     * single buffer). The cursor is automatically positioned on the new line
     * at column 0 by Console.appendLine. Also enables echo deferral so
     * trigger-emitted echoes appear after the rendered line.
     */
    beginLine(buffer: AnsiAwareBuffer, isPrompt = false): void {
        buffer.isPrompt = isPrompt;
        this.mainConsole.appendLine(buffer);
        this.inTriggerProcessing = true;
        this.selection = null;
        this.isDeferringEcho = true;
    }

    /**
     * Called after all triggers for a line have run (but before render).
     * Drops the trigger-active flag; echo deferral stays on until
     * flushDeferredEcho() is called.
     */
    endLine(): void {
        this.inTriggerProcessing = false;
        this.selection = null;
    }

    /**
     * Mudlet `tempColorTrigger(fg, bg)` colour-scan helper. Walks the
     * just-appended line buffer (the one beginLine() seeded mainConsole with)
     * and returns true if any segment carries the requested ANSI palette
     * indices. `wantFg`/`wantBg` accept -1 as "any colour"; non-indexed
     * (RGB) segments never match a positive index, matching Mudlet's
     * palette-only semantics.
     */
    currentLineMatchesColor(wantFg: number, wantBg: number): boolean {
        const buf = this.mainConsole.getBuffer();
        if (!buf) return false;
        for (const seg of buf.getSegments()) {
            if (!seg.text) continue;
            const fg = seg.state?.foreground;
            const bg = seg.state?.background;
            const segFg = fg?.space === 'indexed' ? fg.index : -2;
            const segBg = bg?.space === 'indexed' ? bg.index : -2;
            const fgOk = wantFg === -1 || segFg === wantFg;
            const bgOk = wantBg === -1 || segBg === wantBg;
            if (fgOk && bgOk) return true;
        }
        return false;
    }

    /**
     * Called after all lines in a flushLines batch have been rendered. Emits
     * any echo output collected during trigger processing, in order, after the
     * rendered lines.
     */
    flushDeferredEcho(): void {
        this.isDeferringEcho = false;
        for (const line of this.echoDeferred) {
            this.session.events.emit('message', line, 'trigger-echo');
        }
        this.echoDeferred = [];
        const partial = this.mainConsole.currentPartial;
        if (partial.length > 0) {
            this.session.events.emit('message', partial, 'trigger-echo');
            this.mainConsole.clear();
        }
        this.session.windows.flushAllLines();
    }

    // ── Triggers ──────────────────────────────────────────────────────────────

    /**
     * Feed `text` through the trigger pipeline as if it arrived from the MUD.
     * Routes complete lines through ScriptingEngine.processFlushBatch (same
     * code path as network-driven flushLines) so trigger ordering, ANSI carry,
     * and deferred-echo placement match exactly.
     */
    feedTriggers(text: string): void {
        const lines = text.split('\n');
        const remainder = lines[lines.length - 1];
        const completeLines = lines.slice(0, -1);

        if (completeLines.length === 0) {
            this.mainConsole.echo(text);
            this.drainMain();
            const partial = this.mainConsole.currentPartial;
            if (partial.length > 0) this.session.events.emit('message', partial, 'script-partial');
            return;
        }

        // Wipe any stray partial left by direct echo() calls so trigger echo
        // accumulates fresh during batch processing.
        this.mainConsole.clear();

        if (this.feedDispatcher) {
            this.feedDispatcher([{ text: completeLines.join('\n'), type: 'mud' }]);
        } else {
            // Engine not wired yet (early init): fall back to a raw event.
            this.session.events.emit('flushLines', [{ text: completeLines.join('\n'), type: 'mud' }]);
        }

        if (remainder) {
            this.mainConsole.echo(remainder);
            this.drainMain();
        }
        const partial = this.mainConsole.currentPartial;
        if (partial.length > 0) this.session.events.emit('message', partial, 'script-partial');
    }

    // ── Cursor / line access ──────────────────────────────────────────────────

    /**
     * Mudlet `getCurrentLine([window])`. Returns the text on the cursor's
     * current line, or `null` when the named window doesn't exist — the Lua
     * binding turns that into Mudlet's `(nil, errMsg)` 2-tuple. Falls back to
     * an empty string for the main window (always present, may have no line yet).
     */
    getCurrentLine(windowName?: string): string | null {
        if (!this.consoleExists(windowName)) return null;
        return this.getConsole(windowName)?.getLine() ?? '';
    }

    // Mudlet line-index APIs are 0-indexed: getLineNumber() == cursor.y(),
    // getLineCount()/getLastLineNumber() == size - 1. Missing windows report
    // -1 (Mudlet's "no such window" sentinel). With Console as the canonical
    // buffer (network lines are pushed via beginLine before triggers fire),
    // these read directly off Console — no special trigger branch needed.
    getLineNumber(windowName?: string): number {
        return this.getConsole(windowName)?.getLineNumber() ?? -1;
    }

    getLineCount(windowName?: string): number {
        return this.getConsole(windowName)?.getLineCount() ?? -1;
    }

    getLastLineNumber(windowName?: string): number {
        return this.getConsole(windowName)?.getLineCount() ?? -1;
    }

    // ── Scrolling / scrollbars ────────────────────────────────────────────────
    // Mudlet hides/shows the gutter for the named console (or "main") and
    // independently toggles whether the user can scroll back at all. The
    // [Horizontal]ScrollBar pair only affects the gutter; the Scrolling pair
    // also blocks wheel/key scrolling. Mudlet forbids disable/enableScrolling
    // on the main window — we keep that policy (the binding hands Lua `false`).

    disableScrollBar(windowName?: string): void {
        this.session.windows.setScrollBarVisible(windowName ?? 'main', false);
    }
    enableScrollBar(windowName?: string): void {
        this.session.windows.setScrollBarVisible(windowName ?? 'main', true);
    }
    disableHorizontalScrollBar(windowName?: string): void {
        this.session.windows.setHorizontalScrollBarVisible(windowName ?? 'main', false);
    }
    enableHorizontalScrollBar(windowName?: string): void {
        this.session.windows.setHorizontalScrollBarVisible(windowName ?? 'main', true);
    }
    disableScrolling(windowName?: string): boolean {
        return this.session.windows.setScrollingEnabled(windowName ?? 'main', false);
    }
    enableScrolling(windowName?: string): boolean {
        return this.session.windows.setScrollingEnabled(windowName ?? 'main', true);
    }

    /** Mudlet getScroll — 0-indexed buffer line at the top of the viewport. In
     *  tail mode reports the last line (Mudlet's mCursorY behaviour at end). */
    getScroll(windowName?: string): number {
        return this.session.windows.getScrollLine(windowName ?? 'main');
    }

    /** Mudlet scrollTo. With no line (or a line past end), resume tail mode.
     *  Negative line counts back from the buffer end. */
    scrollTo(windowName: string | undefined, lineNumber: number | undefined): boolean {
        return this.session.windows.scrollToLine(windowName ?? 'main', lineNumber);
    }

    getLines(from: number, to: number, windowName?: string): string[] {
        return this.getConsole(windowName)?.getLines(from, to) ?? [];
    }

    /**
     * Mudlet `getTimestamp([window,] lineNumber)` — the wall-clock time the line
     * entered the buffer, formatted "HH:MM:SS.mmm" (Mudlet's "hh:mm:ss.zzz").
     * `lineNumber` is 1-based to match `getLines`; omit it for the current
     * cursor line. Returns null when the window or line doesn't exist — the Lua
     * binding maps that to Mudlet's `(nil, errMsg)` shape.
     */
    getTimestamp(lineNumber?: number, windowName?: string): string | null {
        if (!this.consoleExists(windowName)) return null;
        const ms = this.getConsole(windowName)?.getLineTimestamp(lineNumber) ?? null;
        return ms == null ? null : formatLineTimestamp(ms);
    }

    /**
     * Mudlet `wrapLine([window,] lineNumber)`. Re-displays the line at
     * `lineNumber` (0-indexed, like getLineNumber/getLineCount), re-interpreting
     * its embedded `\n` and re-wrapping to the current width. Returns false when
     * the window or line doesn't exist.
     */
    wrapLine(lineNumber: number, windowName?: string): boolean {
        return this.getConsole(windowName)?.wrapLine(lineNumber) ?? false;
    }

    /**
     * Mudlet `getConsoleBufferSize([consoleName])` → (linesLimit, batchSize).
     * Returns `null` when the named console doesn't exist so the Lua binding can
     * hand back nil.
     */
    getConsoleBufferSize(windowName?: string): [number, number] | null {
        const con = this.getConsole(windowName);
        if (!con) return null;
        return [con.maxLines, con.batchDeleteSize];
    }

    /**
     * Mudlet `setConsoleBufferSize([consoleName], linesLimit, sizeOfBatchDeletion)`.
     * Sets the scrollback cap (and the round-tripped batch-deletion size).
     * Returns false when the named console doesn't exist.
     */
    setConsoleBufferSize(windowName: string | undefined, linesLimit: number, batchSize?: number): boolean {
        const con = this.getConsole(windowName);
        if (!con) return false;
        if (Number.isFinite(linesLimit) && linesLimit > 0) con.setMaxLines(Math.floor(linesLimit));
        if (batchSize !== undefined && Number.isFinite(batchSize) && batchSize > 0) {
            con.setBatchDeleteSize(Math.floor(batchSize));
        }
        return true;
    }

    getColumnNumber(windowName?: string): number {
        // Mudlet's mUserCursor.x() — just the cursor's column on the cursor's
        // current line. Console owns the persistent column cursor for both
        // history and the in-flight matching line.
        return this.getConsole(windowName)?.getCursorColumn() ?? 0;
    }

    /** Mudlet `isPrompt()` — reports the per-line prompt flag at the current
     *  cursor position. Lines pushed via beginLine carry the flag, so
     *  moveCursor + isPrompt can inspect historical lines, not just the most
     *  recent one. Defaults to false for the main window when no history exists. */
    isPrompt(windowName?: string): boolean {
        return this.getConsole(windowName)?.cursorOnPrompt() ?? false;
    }

    /**
     * Mudlet getColumnCount. Reports the displayable column capacity of the
     * rendered output area — how many monospace characters fit horizontally.
     * Unaffected by setWindowWrap; that controls where lines wrap when text is
     * appended to the buffer, not the screen width. Returning the wrap value
     * would break the canonical Mudlet idiom
     *   setWindowWrap(name, getColumnCount(name) - 1)
     * called from a sysUserWindowResizeEvent handler, where each resize would
     * otherwise feed the stored wrap back in and decrement it by one.
     *
     * Fallback path: scripts that just called openUserWindow + resizeWindow
     * commonly busy-loop on getColumnCount in the same JS turn — React can't
     * render the new panel until the loop yields, so a pure DOM measurement
     * stays at 0 forever and the loop hangs. When the window exists but the
     * element hasn't mounted (or measures zero), derive an estimate from the
     * window's logical pixel width and the active font's cell width, so the
     * reported column count tracks resizeWindow even before layout commits.
     */
    getColumnCount(windowName?: string): number {
        const isMain = !windowName || windowName === 'main';
        const el = isMain
            ? this.session.windows.getElement('main')
            : this.session.windows.getElement(windowName!);
        const measured = measureColumnCapacity(el);
        if (measured > 0) return measured;
        if (isMain) return 0;

        const size = this.session.windows.getSize(windowName!);
        if (!size || size.width <= 0) return 0;
        const profileFamily = selectProfileField(useAppStore.getState(), this.connectionId, 'outputFont')?.family ?? '';
        const profileSize   = selectProfileField(useAppStore.getState(), this.connectionId, 'fontSize') ?? 12;
        const family = this.session.windows.getFont(windowName!) ?? profileFamily;
        const fontSize = this.session.windows.getFontSize(windowName!) ?? profileSize;
        const [cellW] = measureMonospaceCell(family, fontSize);
        if (cellW <= 0) return 0;
        // Match the gutter/padding measureColumnCapacity would subtract once
        // the element mounts (~8px per side on text panels).
        const usable = Math.max(0, size.width - 16);
        return Math.floor(usable / cellW);
    }

    /**
     * Mudlet setWindowWrap(name, charsPerLine). Sets the visual wrap width
     * (in monospace columns) for the named window or "main". 0 clears the
     * setting. Returns false when the named window does not exist; main always
     * succeeds (persisted on the active profile).
     */
    setWindowWrap(name: string, wrapAt: number): boolean {
        if (!Number.isFinite(wrapAt)) return false;
        const v = Math.max(0, Math.round(wrapAt));
        if (!name || name === 'main') {
            useAppStore.getState().patchConnectionProfile(this.connectionId, { outputWrapAt: v > 0 ? v : undefined });
            return true;
        }
        return this.session.windows.setWrap(name, v);
    }

    /**
     * Mudlet `insertText([window,] text)`. Inserts `text` at the cursor on
     * the cursor's current line — works the same way during trigger processing
     * (cursor is on the just-appended matching line) and outside (cursor is
     * wherever moveCursor put it). Falls back to an end-of-buffer echo only
     * when the cursor isn't on a valid line yet (empty buffer / sub-window
     * without a backing buffer).
     */
    insertText(text: string, windowName?: string): void {
        const isMain = !windowName || windowName === 'main';
        const con = this.getConsole(windowName);
        const buf = con?.getBuffer();
        if (con && buf) {
            const state = con.format.toSnapshot();
            const at = Math.max(0, Math.min(con.getCursorColumn(), buf.text.length));
            buf.insert(at, text, state);
            if (!this.inTriggerProcessing) buf.rerender();
            return;
        }
        // No current line: degrade to an echo so the text isn't lost.
        if (isMain) {
            this.mainConsole.echo(text);
            this.drainMain();
        } else {
            this.echoToWindow(windowName!, text);
        }
    }

    /**
     * Mudlet `insertLink([window,] text, cmd, hint, [useCurrentFormat])`.
     * Like `insertText` but the inserted span is a clickable link bound to
     * `cmd`. With `useCurrentFormat=false` (the default) the link inherits
     * Mudlet's built-in style — blue foreground + underline — layered on top
     * of the current pen state. If no buffer is available (empty console,
     * sub-window without backing buffer) the call degrades to `echoLink` so
     * the text isn't lost.
     */
    insertLink(text: string, cmd: string, tooltip: string, windowName?: string, useCurrentFormat = false): void {
        if (!text) return;
        const con = this.getConsole(windowName);
        const buf = con?.getBuffer();
        if (con && buf) {
            const state: FormatStateSnapshot = con.format.toSnapshot();
            state.hyperlink = {
                onClick: () => { this.executeScript?.(cmd); },
                title: tooltip || undefined,
            };
            if (!useCurrentFormat) {
                state.foreground = { space: 'rgb', r: 0, g: 0, b: 255 };
                state.underline = true;
            }
            const at = Math.max(0, Math.min(con.getCursorColumn(), buf.text.length));
            buf.insert(at, text, state);
            if (!this.inTriggerProcessing) buf.rerender();
            return;
        }
        this.echoLink(text, cmd, tooltip, windowName, useCurrentFormat);
    }

    /**
     * Mudlet `moveCursorUp([window,] [lines=1,] [keepHorizontal=false]) → bool`.
     * `keepHorizontal=true` preserves the column across the vertical move; the
     * default (false) resets the column to 0.
     */
    moveCursorUp(windowName?: string, lines: number = 1, keepHorizontal: boolean = false): boolean {
        return this.getConsole(windowName)?.moveUp(lines, keepHorizontal) ?? false;
    }

    moveCursorDown(windowName?: string, lines: number = 1, keepHorizontal: boolean = false): boolean {
        return this.getConsole(windowName)?.moveDown(lines, keepHorizontal) ?? false;
    }

    /**
     * Mudlet `moveCursor([window,] x, y) → bool`. The cursor is just an (x,y)
     * into the central buffer — works the same way during trigger processing
     * and outside, because the matching line is pushed into Console.history
     * before triggers fire (Mudlet has the same model: matching line is the
     * last line in TBuffer; cursor.y is its index). Returns true on a
     * successful move.
     */
    moveCursor(windowName: string | undefined, x: number, y: number): boolean {
        if (!Number.isFinite(x) || x < 0) return false;
        if (!Number.isFinite(y) || y < 0) return false;
        return this.getConsole(windowName)?.moveTo(y, x) ?? false;
    }

    moveCursorEnd(windowName?: string): void {
        const con = this.getConsole(windowName);
        if (!con) return;
        const lastLine = con.getLineCount();
        con.moveTo(lastLine);
        con.setCursorColumn(con.getLine().length);
        con.markCursorAtEnd();
    }

    // ── Window / line management ──────────────────────────────────────────────

    clearWindow(name?: string): void {
        if (!name || name === 'main') {
            this.session.events.emit('script.clearwindow');
        } else if (this.buffers.has(name)) {
            // Off-screen buffer: WindowManager.clear no-ops (no panel), so clear
            // the backing console directly.
            this.getConsole(name)?.clear();
        } else {
            this.session.windows.clear(name);
        }
    }

    /**
     * Mudlet `createMiniConsole([parent,] name, x, y, width, height)`. Creates
     * a positioned text panel inside the given parent (defaults to `main`), or
     * repositions it if it already exists (Mudlet 3.0+ semantics). When parent
     * is a userwindow, the miniconsole renders inside that parent's viewport
     * at parent-relative coordinates and follows parent moves/resizes.
     * Returns true on success.
     */
    createMiniConsole(name: string, x: number, y: number, width: number, height: number, parent?: string): boolean {
        if (!name) return false;
        const wm = this.session.windows;
        if (!wm.has(name)) {
            wm.open(name, {
                kind: 'text',
                title: name,
                autoDock: false,
                ignoreHint: true,
                parent: parent && parent !== 'main' ? parent : undefined,
            });
        } else {
            wm.show(name);
        }
        wm.markAsMiniConsole(name);
        wm.setPosition(name, Math.round(x), Math.round(y));
        wm.setSize(name, Math.round(width), Math.round(height));
        return true;
    }

    /**
     * Mudlet `deleteMiniConsole(name)`. Destroys a mini-console created by
     * createMiniConsole, freeing its registry/buffer/console state. Restricted
     * to mini-consoles (mirrors Mudlet's CONSOLE-only check) — returns false
     * for the main window, dockable panels, or an unknown name.
     */
    deleteMiniConsole(name: string): boolean {
        if (!name || name === 'main') return false;
        if (!this.session.windows.isMiniConsole(name)) return false;
        this.session.windows.close(name);
        this.eventRaiser?.('sysMiniConsoleDeleted', [name]);
        return true;
    }

    /**
     * Mudlet `createBuffer(name)`. Registers a named off-screen console for
     * formatting and storing rich text — like a miniconsole, but never shown
     * on screen (no dock panel). echo/cecho/format/selection target it by name;
     * `copy` + `appendBuffer` move formatted text in and out. Idempotent and a
     * no-op when the name is taken by `main` or an existing on-screen window.
     */
    createBuffer(name: string): void {
        if (!name || name === 'main') return;
        if (this.session.windows.has(name)) return;
        this.buffers.add(name);
        // Register the backing console so echo/selection resolve it by name.
        this.outputConsole(name);
    }

    /** True when `name` is an off-screen buffer created via createBuffer. */
    isBuffer(name: string): boolean {
        return this.buffers.has(name);
    }

    /**
     * Mudlet `copy([window])`. Copies the current selection of the resolved
     * console — including all formatting — into the session clipboard, a single
     * rich-text buffer shared with `paste`/`appendBuffer` (Mudlet's host-global
     * mClipboard). No-op when there's no selection, or when `window` is given
     * but doesn't own the active selection.
     */
    copy(windowName?: string): void {
        if (!this.selection) return;
        if (windowName !== undefined && !this.selectionMatches(windowName)) return;
        const buf = this.resolveBuffer(this.selection.windowName);
        if (!buf) return;
        const start = Math.max(0, Math.min(this.selection.start, buf.length));
        const end = Math.max(start, Math.min(this.selection.start + this.selection.length, buf.length));
        const slice = buf.clone();
        slice.remove([end, slice.length]);
        slice.remove([0, start]);
        this.clipboard = slice;
    }

    /**
     * Mudlet `appendBuffer([window])`. Appends the clipboard's rich text (from
     * the last `copy()`) as a new line at the end of the named console's buffer.
     * No-op until something has been copied. Mirrors TConsole::appendBuffer.
     */
    appendBuffer(windowName?: string): void {
        if (!this.clipboard) return;
        const isMain = !windowName || windowName === 'main';
        const con = this.outputConsole(windowName);
        con.appendBuffer(this.clipboard.clone());
        if (isMain) this.drainMain();
        else this.drainWindowConsole(windowName!, con);
    }

    /**
     * Mudlet `paste([window])`. Inserts the clipboard at the cursor's current
     * column when the cursor sits above the last line; otherwise appends it as
     * a new line at the end (TConsole::paste semantics). No-op without a prior
     * copy().
     */
    paste(windowName?: string): void {
        if (!this.clipboard) return;
        const con = this.outputConsole(windowName);
        const buf = con.getBuffer();
        if (buf && con.getLineNumber() < con.getLineCount()) {
            const at = Math.max(0, Math.min(con.getCursorColumn(), buf.text.length));
            buf.insertBuffer(at, this.clipboard.clone());
            if (!this.inTriggerProcessing) buf.rerender();
            return;
        }
        const isMain = !windowName || windowName === 'main';
        con.appendBuffer(this.clipboard.clone());
        if (isMain) this.drainMain();
        else this.drainWindowConsole(windowName!, con);
    }

    /**
     * Mudlet `createMapper([parent,] x, y, width, height)`. Creates a positioned
     * mapper widget inside the given parent (defaults to `main`), or repositions
     * it if it already exists. Singleton: Mudlet allows only one in-console
     * mapper at a time, so we reuse a fixed id (`mapper`) — distinct from the
     * dockable map widget opened by `openMapWidget` (id `map`). Both render the
     * same MapStore and stay in sync. Returns true on success.
     */
    createMapper(x: number, y: number, width: number, height: number, parent?: string): boolean {
        const wm = this.session.windows;
        const id = 'mapper';
        if (!wm.has(id)) {
            wm.open(id, {
                kind: 'map',
                title: 'Mapper',
                autoDock: false,
                ignoreHint: true,
                parent: parent && parent !== 'main' ? parent : undefined,
            });
        } else {
            wm.show(id);
        }
        wm.markAsMiniConsole(id);
        wm.setPosition(id, Math.round(x), Math.round(y));
        wm.setSize(id, Math.round(width), Math.round(height));
        return true;
    }

    /**
     * Mudlet `replace([win,] with, [keepcolor])`. Default (`keepcolor=false`)
     * applies the resolved console's current pen state (set via
     * setFgColor/setBgColor/etc.) to the replacement text. With
     * `keepcolor=true`, the replacement inherits the selection's existing
     * format — same as our previous behavior.
     */
    replace(newText: string, windowName?: string, keepColor = false): void {
        if (!this.selection) return;
        const sel = this.selection;
        const targetWin = windowName ?? sel.windowName;
        const buf = this.resolveBuffer(targetWin);
        if (!buf) return;
        const state = keepColor ? undefined : this.outputConsole(targetWin).format.toSnapshot();
        buf.replace([sel.start, sel.start + sel.length], newText, state);
        this.selection = null;
        if (!this.inTriggerProcessing) buf.rerender();
    }

    /**
     * Mudlet `deleteLine([window])`. Marks the cursor's current buffer as
     * deleted. When that buffer is the matching line of an in-flight trigger,
     * the renderer skips emitting it; when it's a rendered history line,
     * Console.deleteLine removes it from the DOM.
     */
    deleteLine(windowName?: string): void {
        const con = this.getConsole(windowName);
        if (!con) return;
        const buf = con.getBuffer();
        if (this.inTriggerProcessing && buf) {
            buf.markAsDeleted();
            return;
        }
        con.deleteLine();
    }

    appendCmdLine(text: string): void {
        this.session.events.emit('script.appendcmd', text);
    }

    printCmdLine(text: string): void {
        this.session.events.emit('script.setcmd', text);
    }

    clearCmdLine(): void {
        this.session.events.emit('script.clearcmd');
    }

    /**
     * Mudlet selectCmdLineText([commandLine]). Selects (highlights) all text in
     * the command bar so the next keystroke overtypes it. mudix has a single
     * main command bar; a named overlay command-line arg is accepted for
     * compatibility but only "main"/omitted is acted upon. The actual DOM
     * selection happens in ProfileSession, which owns the input ref.
     */
    selectCmdLineText(name?: string): void {
        if (name && name !== 'main') return;
        this.session.events.emit('script.selectcmd');
    }

    /**
     * Mudlet setCommandBackgroundColor([windowName], r, g, b, [transparency]).
     * Recolors the command bar's background. mudix only has the main command
     * bar, so a non-"main" windowName is ignored. `a` is Mudlet's 0..255 alpha;
     * the CommandBar reads the `inputBackground` profile field as a CSS color.
     */
    setCommandBackgroundColor(r: number, g: number, b: number, a = 255, name?: string): boolean {
        if (name && name !== 'main') return false;
        useAppStore.getState().patchConnectionProfile(this.connectionId, {
            inputBackground: rgbaCss(r, g, b, a),
        });
        return true;
    }

    /** Mudlet setCommandForegroundColor — recolors the command bar text. */
    setCommandForegroundColor(r: number, g: number, b: number, a = 255, name?: string): boolean {
        if (name && name !== 'main') return false;
        useAppStore.getState().patchConnectionProfile(this.connectionId, {
            inputForeground: rgbaCss(r, g, b, a),
        });
        return true;
    }

    // ── Command-line value provider (Mudlet getCmdLine) ────────────────────────
    // The current input string lives in React state inside ProfileSession.
    // ProfileSession registers a getter via setCmdLineProvider so the script
    // API can read the value synchronously without round-tripping through an
    // event. Provider is cleared when no command bar is mounted.
    private cmdLineProvider: (() => string) | null = null;

    setCmdLineProvider(fn: (() => string) | null): void {
        this.cmdLineProvider = fn;
    }

    getCmdLine(): string {
        return this.cmdLineProvider?.() ?? '';
    }

    // ── Command-line tab-completion suggestions ───────────────────────────────
    // Mudlet's addCmdLineSuggestion family. Stored as an insertion-ordered Set
    // so addCmdLineSuggestion("a"); add("b") feeds tab completion as ["a","b"].
    // CommandBar merges these with command history when computing matches.
    // Mutations emit `script.cmdlinesuggestions` with the current snapshot so
    // React can re-render without polling.
    private cmdLineSuggestions = new Set<string>();

    addCmdLineSuggestion(suggestion: string): void {
        const s = suggestion ?? '';
        if (!s) return;
        if (this.cmdLineSuggestions.has(s)) return;
        this.cmdLineSuggestions.add(s);
        this.emitCmdLineSuggestions();
    }

    removeCmdLineSuggestion(suggestion: string): void {
        if (this.cmdLineSuggestions.delete(suggestion ?? '')) {
            this.emitCmdLineSuggestions();
        }
    }

    clearCmdLineSuggestions(): void {
        if (this.cmdLineSuggestions.size === 0) return;
        this.cmdLineSuggestions.clear();
        this.emitCmdLineSuggestions();
    }

    getCmdLineSuggestions(): string[] {
        return [...this.cmdLineSuggestions];
    }

    private emitCmdLineSuggestions(): void {
        this.session.events.emit('script.cmdlinesuggestions', [...this.cmdLineSuggestions]);
    }

    /**
     * Mudlet `openUrl(url) → bool`. Opens a URL in a new browser tab. Special
     * case: a `file:` prefix (as in `openUrl("file:" .. getMudletHomeDir())`)
     * routes to the in-app VFS file browser at the given path, since web pages
     * can't navigate to `file:` URLs.
     */
    openUrl(url: string): boolean {
        const u = (url ?? '').trim();
        if (!u) return false;
        if (u.startsWith('file:')) {
            // Accept file:, file://, and file:/// prefixes — keep the path's
            // leading slash so VFS paths like /profiles/<id>/... resolve.
            const path = u.replace(/^file:(\/\/)?/, '');
            this.session.events.emit('script.openvfs', path);
            return true;
        }
        const w = window.open(u, '_blank', 'noopener,noreferrer');
        return !!w;
    }

    // ── Command-line action (Mudlet setCmdLineAction) ─────────────────────────
    // When set, the action receives every Enter-submitted line *before* alias
    // matching and the MUD send. The script fully owns the command bar — it
    // may parse, store, route, or re-emit the text via send()/expandAlias().
    private cmdLineAction: ((text: string) => void) | null = null;

    setCmdLineAction(fn: ((text: string) => void) | null): void {
        this.cmdLineAction = fn;
    }

    /** Engine-side accessor: returns the currently registered action, or null. */
    getCmdLineAction(): ((text: string) => void) | null {
        return this.cmdLineAction;
    }

    // ── Stylesheets (Mudlet setAppStyleSheet / setUserWindowStyleSheet) ───────
    // Real Mudlet APIs that scripts (theme switchers, package CSS) depend on.
    // Browser equivalent: install or replace a `<style>` tag in document.head
    // keyed by `tag` (app-wide) or window name (per-window). Per-window CSS is
    // translated through `userWindowQssToScopedCss`: `QWidget { … }` (the
    // canonical Mudlet selector) auto-scopes to `[data-mudix-window="name"]`,
    // so a stylesheet like `QWidget { padding: 15 20; }` actually pads the
    // window viewport. Scripts can still write the attribute selector
    // explicitly for non-`QWidget` rules. After a successful app-level install
    // we raise sysAppStyleSheetChange via `eventRaiser` so themes can hook
    // re-applies.

    private eventRaiser: ((event: string, args: unknown[]) => void) | null = null;

    setEventRaiser(fn: ((event: string, args: unknown[]) => void) | null): void {
        this.eventRaiser = fn;
    }

    setAppStyleSheet(css: string, tag?: string): boolean {
        const key = tag && tag.length > 0 ? tag : 'default';
        const id = `mudix-app-stylesheet-${key}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            el.dataset.mudixAppStylesheet = key;
            document.head.appendChild(el);
        }
        el.textContent = css ?? '';
        this.eventRaiser?.('sysAppStyleSheetChange', [css ?? '', tag ?? '']);
        return true;
    }

    setUserWindowStyleSheet(name: string, css: string): boolean {
        if (!name) return false;
        const id = `mudix-userwindow-stylesheet--${name}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            el.dataset.mudixUserwindowStylesheet = name;
            document.head.appendChild(el);
        }
        const scope = `[data-mudix-window="${cssEscape(name)}"]`;
        el.textContent = userWindowQssToScopedCss(css ?? '', scope);
        return true;
    }

    centerView(roomId: number): void {
        this.session.windows.centerView(roomId);
    }

    /**
     * Mudlet `getMapZoom([areaID])`. mudix renders one area at a time through a
     * single shared 2D view, so `areaID` has no per-area analogue — the current
     * view's zoom is returned regardless. The value is Mudlet-compatible: the
     * number of map units visible across the viewport's shorter edge. Returns
     * false when no map panel is mounted (the Lua binding turns that into nil).
     */
    getMapZoom(_areaID?: number): number | false {
        return this.session.windows.getMapZoom() ?? false;
    }

    /**
     * Mudlet `setMapZoom(zoom [, areaID])`. `zoom` is the number of map units to
     * fit across the viewport's shorter edge (larger = more map shown / zoomed
     * out); like Mudlet it must be at least 3.0. Returns false for an invalid
     * zoom or when no map panel is mounted to receive it.
     */
    setMapZoom(zoom: number, _areaID?: number): boolean {
        if (!Number.isFinite(zoom) || zoom < 3) return false;
        return this.session.windows.setMapZoom(zoom);
    }

    /** Mudlet `updateMap()` — force the map to re-read MapStore and redraw. */
    updateMap(): void {
        this.session.windows.updateMap();
    }

    getRoomIDbyHash(hash: string): number | undefined {
        return this.session.windows.getRoomIDbyHash(hash);
    }

    // ── Map scripting API ─────────────────────────────────────────────────────

    get map() { return this.session.windows.mapStore; }

    get cmdLineMenu() { return this.session.cmdLineMenu; }

    get sounds() { return this.session.sounds; }

    get videos() { return this.session.videos; }

    /** Mudlet `setMapBackgroundColor(r, g, b)`. Persists into the profile
     *  mapper settings so MapPanel picks it up on its next render pass. */
    setMapBackgroundColor(r: number, g: number, b: number): boolean {
        const rr = clamp255(r);
        const gg = clamp255(g);
        const bb = clamp255(b);
        const hex = '#' + [rr, gg, bb].map(c => c.toString(16).padStart(2, '0')).join('');
        const store = useAppStore.getState();
        const prev = store.connectionProfile[this.connectionId]?.mapper ?? {};
        store.patchConnectionProfile(this.connectionId, { mapper: { ...prev, backgroundColor: hex } });
        return true;
    }

    /** Mudlet `setMapRoomSize(size)`. Maps to renderer.settings.roomSize via
     *  the profile mapper field. Returns false for non-positive values. */
    setMapRoomSize(size: number): boolean {
        if (!Number.isFinite(size) || size <= 0) return false;
        const store = useAppStore.getState();
        const prev = store.connectionProfile[this.connectionId]?.mapper ?? {};
        store.patchConnectionProfile(this.connectionId, { mapper: { ...prev, roomSize: size } });
        return true;
    }

    /** Mudlet `getMapRoomSize()`. Reads the active room-size value. Falls back
     *  to the MAPPER_DEFAULTS.roomSize when unset. */
    getMapRoomSize(): number {
        const store = useAppStore.getState();
        const mapper = store.connectionProfile[this.connectionId]?.mapper;
        return mapper?.roomSize ?? 0.6;
    }

    /**
     * Mudlet `loadMap([location])`. Persists the bytes (when given) to the
     * connection's binary-map IndexedDB slot and re-renders any open MapPanel.
     * The Lua binding in LuaRuntime reads the VFS path before calling here so
     * this method only deals in already-decoded bytes. Returns true unless the
     * panel reported a parse failure for the given buffer.
     */
    loadMap(buf?: Uint8Array): boolean {
        if (!buf) return this.session.windows.loadMap();
        // Copy into a fresh standalone ArrayBuffer — the source may be a slice
        // of a larger buffer (e.g. a Node Buffer view onto a pool) or a
        // SharedArrayBuffer-backed view, both of which the binary reader chokes on.
        const out = new ArrayBuffer(buf.byteLength);
        new Uint8Array(out).set(buf);
        return this.session.windows.loadMap(out);
    }

    /**
     * Mudlet `saveMap([location])`. Serialises the current MapStore to the
     * Mudlet binary `.dat` format and persists it to the connection's default
     * IndexedDB slot (so it survives reload). Returns the bytes so the Lua
     * binding can also write them to a VFS path when one is supplied. Returns
     * null when serialisation fails.
     */
    saveMap(): Uint8Array | null {
        const buf = this.session.windows.saveMap();
        return buf ? new Uint8Array(buf) : null;
    }

    /** Mudlet `saveJsonMap(path)` backbone — serialises the current MapStore
     *  as JSON. The Lua binding writes the result to the supplied VFS path. */
    saveJsonMap(): string { return this.session.windows.saveJsonMap(); }

    /** Mudlet `loadJsonMap(path)` backbone — parse a JSON payload previously
     *  produced by saveJsonMap and reload the map. Returns false when the
     *  JSON is malformed or doesn't match the MudletMap shape. */
    loadJsonMap(json: string): boolean { return this.session.windows.loadJsonMap(json); }

    /** Mudlet `addSupportedTelnetOption(option)`. Forwarded to the session
     *  client so the next IAC WILL/DO from the server can be auto-accepted. */
    addSupportedTelnetOption(option: number): boolean {
        return this.session.addSupportedTelnetOption(option);
    }

    /**
     * Mudlet `saveWindowLayout()` — capture the current layout (window hints
     * + dock area extents) into a per-connection snapshot in the persisted
     * app store. A later `loadWindowLayout()` re-applies the captured state.
     * Returns true on success, false when no connectionId is bound.
     */
    saveWindowLayout(): boolean {
        if (!this.connectionId) return false;
        const snapshot = this.session.windows.captureLayoutSnapshot();
        useAppStore.getState().saveLayoutSnapshot(this.connectionId, snapshot);
        return true;
    }

    /**
     * Mudlet `loadWindowLayout()` — restore the most recently saved snapshot
     * for this connection. Re-applies geometry, dock state, font/colour, and
     * visibility to live windows; opens windows that the snapshot had visible
     * but are not currently mounted. Returns false when no snapshot exists.
     */
    loadWindowLayout(): boolean {
        if (!this.connectionId) return false;
        const snapshot = useAppStore.getState().connectionLayoutSnapshots[this.connectionId];
        if (!snapshot) return false;
        this.session.windows.applyLayoutSnapshot(snapshot);
        return true;
    }

    // ── Misc ──────────────────────────────────────────────────────────────────

    /**
     * Mudlet `getTime()` — current local time as a record. The Bridge.lua wrapper
     * picks fields off this object for the `{year, month, day, hour, min, sec,
     * msec}` table form, and uses `wday` (0=Sun..6=Sat) to format `ddd`/`dddd`
     * tokens when the script asks for a formatted string.
     */
    getTime(): { year: number; month: number; day: number; hour: number; min: number; sec: number; msec: number; wday: number } {
        const d = new Date();
        return {
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            hour: d.getHours(),
            min: d.getMinutes(),
            sec: d.getSeconds(),
            msec: d.getMilliseconds(),
            wday: d.getDay(),
        };
    }

    /**
     * Mudlet `getNetworkLatency()` — round-trip time of the most recent
     * keep-alive ping. Returns the last measured value (in ms) for as long as
     * the connection is up; -1 when no measurement has been made yet (mirrors
     * Mudlet's "not yet measured" sentinel — better than a fake 0 which would
     * read as "instant" in scripts charting latency).
     */
    getNetworkLatency(): number {
        const fresh = this.session.ping;
        if (fresh != null) {
            this.lastPingMs = fresh;
            return fresh;
        }
        return this.lastPingMs ?? -1;
    }

    private lastPingMs: number | null = null;

    getMainWindowSize(): [number, number] {
        // Reports the full viewport (the coordinate space labels live in), not
        // the console area. Borders carve insets out of this rectangle without
        // shrinking it — matches Mudlet so scripts that place labels with
        // `y = h - labelHeight` after setBorderBottom land in the carved zone.
        const el = this.session.windows.getMainViewportElement()
                ?? this.session.windows.getElement('main');
        if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) return [rect.width, rect.height];
        }
        return [window.innerWidth, window.innerHeight];
    }

    /**
     * Mudlet `hasFocus([window])` → bool. Reports whether the named console (or
     * the main command bar / output area when omitted) currently holds keyboard
     * focus. mudix maps "main"/omitted to the command input, and a named window
     * to its registered overlay element. Returns false when nothing matches.
     */
    hasFocus(windowName?: string): boolean {
        if (typeof document === 'undefined') return false;
        const activeEl = document.activeElement;
        if (!activeEl) return false;
        if (!windowName || windowName === 'main') {
            const input = document.querySelector('.command-input');
            return !!input && (activeEl === input || (!!input && input.contains(activeEl)));
        }
        const el = this.session.windows.getElement(windowName);
        return !!el && (activeEl === el || el.contains(activeEl));
    }

    /**
     * Mudlet `alert([seconds])`. Mudlet flashes the taskbar entry to grab the
     * user's attention; browsers have no taskbar-flash API, so we flash the
     * document title (alternating with a "● " bell prefix) for `seconds`
     * (default 10, Mudlet's default), and skip the flash entirely while the tab
     * is already focused — matching Mudlet, which no-ops when the window is
     * active.
     */
    alert(seconds?: number): void {
        if (typeof document === 'undefined') return;
        if (document.hasFocus()) return;
        const dur = Number.isFinite(seconds) && (seconds as number) > 0 ? (seconds as number) : 10;
        if (this.alertTimer !== null) {
            clearInterval(this.alertTimer);
            this.alertTimer = null;
            if (this.alertOriginalTitle !== null) document.title = this.alertOriginalTitle;
        }
        this.alertOriginalTitle = document.title;
        const base = this.alertOriginalTitle;
        let on = false;
        const flip = () => {
            on = !on;
            document.title = on ? `● ${base}` : base;
        };
        flip();
        this.alertTimer = window.setInterval(flip, 1000);
        const stop = () => {
            if (this.alertTimer !== null) { clearInterval(this.alertTimer); this.alertTimer = null; }
            if (this.alertOriginalTitle !== null) { document.title = this.alertOriginalTitle; this.alertOriginalTitle = null; }
            window.removeEventListener('focus', stop);
        };
        window.addEventListener('focus', stop);
        window.setTimeout(stop, dur * 1000);
    }
    private alertTimer: number | null = null;
    private alertOriginalTitle: string | null = null;

    /**
     * Mudlet `getMainConsoleWidth()` — pixel width of the main console's text
     * area. Mudlet computes `averageCharWidth * (wrapAt + 1)`; we mirror that
     * with a canvas-measured monospace cell for the profile's output font, and
     * resolve the wrap column from the profile's `outputWrapAt` override (the
     * value `setWindowWrap("main", n)` writes), falling back to the live
     * measured column count when no explicit wrap is set.
     */
    getMainConsoleWidth(): number {
        const state = useAppStore.getState();
        const family = selectProfileField(state, this.connectionId, 'outputFont')?.family ?? '';
        const size = selectProfileField(state, this.connectionId, 'fontSize') ?? 12;
        const [cellW] = measureMonospaceCell(family, size);
        const wrapAt = selectProfileField(state, this.connectionId, 'outputWrapAt')
            ?? this.getColumnCount('main');
        return Math.round(cellW * (wrapAt + 1));
    }

    /**
     * Mudlet `getConnectionInfo()` → `host, port, connected`. Mudlet reports the
     * MUD's telnet host/port; mudix reads them off the active connection config.
     * For a `mud`-mode connection those are the stored host/port; for a raw
     * `websocket` connection we parse them out of the endpoint URL (port falls
     * back to the ws/wss default). `connected` reflects the live session status.
     */
    getConnectionInfo(): { host: string; port: number; connected: boolean } {
        const conn = useAppStore.getState().connections.find(c => c.id === this.connectionId);
        let host = '';
        let port = 0;
        if (conn) {
            if (conn.mode === 'mud') {
                host = conn.host ?? '';
                port = conn.port ?? 23;
            } else if (conn.url) {
                try {
                    const u = new URL(conn.url);
                    host = u.hostname;
                    port = u.port ? Number(u.port) : (u.protocol === 'wss:' ? 443 : 80);
                } catch { /* malformed url → leave host/port at defaults */ }
            }
        }
        return { host, port, connected: this.session.status === 'connected' };
    }

    /**
     * Mudlet `connectToServer(host, port [, save])`. mudix tunnels MUD traffic
     * through a WebSocket proxy, so this builds the same `proxy?host=&port=` URL
     * the connection screen uses and (re)connects the live session. With `save`,
     * the host/port are persisted onto the active connection (switching it to
     * mud-mode) so they survive a reload — the analogue of Mudlet's profile
     * write. Returns false for an out-of-range port.
     */
    connectToServer(host: string, port = 23, save = false): boolean {
        if (!Number.isFinite(port) || port < 1 || port > 65535) return false;
        const state = useAppStore.getState();
        const conn = state.connections.find(c => c.id === this.connectionId);
        const url = connectionUrl(
            conn
                ? { ...conn, mode: 'mud', host, port }
                : { id: this.connectionId, name: '', mode: 'mud', host, port },
            state.client.userProxyUrl,
        );
        if (!url) return false;
        if (save && conn) {
            state.updateConnection(this.connectionId, { ...conn, mode: 'mud', host, port });
        }
        this.session.connect(url);
        return true;
    }

    /**
     * Mudlet `getLabelSizeHint(name)` → `width, height` (the label's preferred
     * content size). Returns null when no such label — the Lua binding maps that
     * to Mudlet's `(nil, errMsg)` shape.
     */
    getLabelSizeHint(name: string): { width: number; height: number } | null {
        return this.labels.getSizeHint(name);
    }

    /**
     * Mudlet `announce(text [, processing])` — push `text` to assistive tech.
     * Mudlet raises a Qt accessibility announcement; the browser equivalent is
     * an ARIA live region. `processing` maps to live-region politeness exactly
     * as Mudlet does: `importantall`/`importantmostrecent` → `assertive`, every
     * other value → `polite`. Two persistent off-screen regions are reused so
     * repeated calls don't pile up DOM nodes. The text is cleared then re-set on
     * a microtask so screen readers re-announce even identical consecutive
     * messages (a live region that doesn't change is not spoken again).
     */
    announce(text: string, processing?: string): void {
        if (typeof document === 'undefined' || !text) return;
        const assertive = processing === 'importantall' || processing === 'importantmostrecent';
        const id = assertive ? 'mudix-aria-live-assertive' : 'mudix-aria-live-polite';
        let region = document.getElementById(id);
        if (!region) {
            region = document.createElement('div');
            region.id = id;
            region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
            region.setAttribute('aria-atomic', 'true');
            region.setAttribute('role', 'status');
            // Visually-hidden but still read by screen readers.
            region.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);border:0;white-space:nowrap';
            document.body.appendChild(region);
        }
        const el = region;
        el.textContent = '';
        setTimeout(() => { el.textContent = text; }, 50);
    }

    /**
     * Mudlet `showNotification(title [, content [, expiryInSeconds]])` → true.
     * Mudlet pops a system tray notification; the browser equivalent is the Web
     * Notifications API. `content` defaults to `title` (matching Mudlet). `expiry`
     * (when given, ≥1s) auto-closes the notification.
     *
     * Gated on the user having opted in via Settings (`client.notificationsEnabled`),
     * which is also where the browser permission prompt is raised — so we never
     * trigger a permission pop-up from a script call here, and silently no-op
     * unless the user enabled notifications AND the browser granted permission.
     * Mudlet always returns true regardless of whether anything is shown, so we
     * match that — the return value reflects "the call was accepted", not "a
     * notification appeared".
     */
    showNotification(title: string, content?: string, expirySeconds?: number): boolean {
        const enabled = useAppStore.getState().client.notificationsEnabled === true;
        if (enabled
            && typeof window !== 'undefined'
            && 'Notification' in window
            && Notification.permission === 'granted') {
            try {
                const n = new Notification(title, { body: content ?? title });
                if (expirySeconds && expirySeconds > 0) {
                    setTimeout(() => n.close(), Math.max(1000, Math.round(expirySeconds * 1000)));
                }
            } catch { /* construction can throw where the API needs a SW (e.g. mobile) */ }
        }
        return true;
    }

    /**
     * Mudlet getMousePosition() → x, y in main-console-local pixels. Tracked
     * passively via document-level pointermove/mousedown — before any input
     * has been seen returns 0,0. When the cursor is outside the main viewport
     * the result is negative or past the viewport bounds (same as Qt's
     * mapFromGlobal). Falls back to viewport coords if the main element
     * isn't mounted.
     */
    getMousePosition(): [number, number] {
        if (Number.isNaN(lastPointerClientX) || Number.isNaN(lastPointerClientY)) {
            return [0, 0];
        }
        const el = this.session.windows.getMainViewportElement()
                ?? this.session.windows.getElement('main');
        if (el) {
            const rect = el.getBoundingClientRect();
            return [Math.round(lastPointerClientX - rect.left),
                    Math.round(lastPointerClientY - rect.top)];
        }
        return [Math.round(lastPointerClientX), Math.round(lastPointerClientY)];
    }

    /**
     * Mudlet getUserWindowSize(name). Returns the rendered [width, height] of a
     * userwindow / miniconsole in pixels. Reports the live element box when the
     * panel is mounted (so docked panels reflect their actual on-screen size),
     * otherwise falls back to the stored window hint. Returns [0, 0] when the
     * window doesn't exist.
     */
    getUserWindowSize(name: string): [number, number] {
        const size = name ? this.session.windows.getSize(name) : null;
        if (!size) return [0, 0];
        return [size.width, size.height];
    }

    /**
     * Mudlet setFontSize. Without `win` (or "main"), persists the size on the
     * active profile so the main output picks it up. With a window name, sets
     * the per-window output font size on WindowManager (saved into the hint).
     */
    setFontSize(size: number, win?: string): boolean {
        if (!Number.isFinite(size) || size < 1 || size > 99) return false;
        const rounded = Math.round(size);
        if (!win || win === 'main') {
            useAppStore.getState().patchConnectionProfile(this.connectionId, { fontSize: rounded });
            return true;
        }
        return this.session.windows.setFontSize(win, rounded);
    }

    /**
     * Mudlet setMiniConsoleFontSize. Strictly targets miniconsoles (created via
     * createMiniConsole / createConsole) — userwindows and labels are rejected
     * the same way Mudlet's CONSOLE-only lookup rejects them.
     */
    setMiniConsoleFontSize(name: string, size: number): boolean {
        if (!name || !this.session.windows.isMiniConsole(name)) return false;
        if (!Number.isFinite(size) || size < 1 || size > 99) return false;
        return this.session.windows.setFontSize(name, Math.round(size));
    }

    /**
     * Mudlet getFontSize. Returns the configured font size in pixels for the
     * main window (when no name passed) or for a specific window. Returns null
     * if a named window doesn't exist or has no override.
     */
    getFontSize(win?: string): number | null {
        if (!win || win === 'main') return selectProfileField(useAppStore.getState(), this.connectionId, 'fontSize');
        if (!this.session.windows.has(win)) return null;
        return this.session.windows.getFontSize(win) ?? selectProfileField(useAppStore.getState(), this.connectionId, 'fontSize');
    }

    /**
     * Mudlet setBackgroundColor. With no name (or "main") sets the main window
     * background; otherwise dispatches to the matching label or userwindow/
     * miniconsole. Channels are 0..255; alpha defaults to 255.
     */
    setBackgroundColor(name: string | undefined, r: number, g: number, b: number, a = 255): boolean {
        if (!name || name === 'main') {
            useAppStore.getState().patchConnectionProfile(this.connectionId, { outputBackgroundColor: { r, g, b, a } });
            return true;
        }
        if (this.session.labels.has(name)) {
            return this.session.labels.setBackgroundColor(name, r, g, b, a);
        }
        return this.session.windows.setBackgroundColor(name, r, g, b, a);
    }

    /**
     * Mudlet getBackgroundColor. Without a name (or "main") returns the main
     * window background; otherwise looks up the named window/miniconsole. Labels
     * fall through here too — their fill color is reported. Returns null when
     * the name doesn't resolve to anything; callers (Lua wrapper) translate that
     * to a 4-tuple of zeros.
     */
    getBackgroundColor(name?: string): { r: number; g: number; b: number; a: number } | null {
        if (!name || name === 'main') {
            return selectProfileField(useAppStore.getState(), this.connectionId, 'outputBackgroundColor') ?? null;
        }
        if (this.session.labels.has(name)) {
            return this.session.labels.getBackgroundColor(name);
        }
        return this.session.windows.getBackgroundColor(name);
    }

    /**
     * Mudlet `setBackgroundImage`. Dispatcher across labels, miniconsoles /
     * userwindows, and the main window — matches Mudlet's overload set:
     *
     *   setBackgroundImage(labelName, imageLocation)           → label
     *   setBackgroundImage(imageLocation, [mode])              → main console
     *   setBackgroundImage(windowName, imageLocation, [mode])  → miniconsole / userwindow
     *
     * Disambiguation matches Mudlet's C++ semantics — label lookup wins when
     * the named widget is a label; otherwise the call is treated as a console
     * form. `mode` arrives already coerced to a number by the GUIUtils.lua
     * wrapper (string mode like "center" → 2 via `mudlet.BgImageMode`). For
     * label form `imageLocation` is a VFS path, resolved through the same
     * rewriter that powers setLabelStyleSheet so package-bundled images work
     * without scripts knowing about the vfs:// scheme.
     */
    setBackgroundImage(a: string, b?: string | number, c?: number): boolean {
        // 1 arg: setBackgroundImage(path) → main, default to border (mode 1).
        if (b === undefined) {
            return this.applyBackgroundImage(undefined, a, 1);
        }
        // 2 args.
        if (c === undefined) {
            // (path, mode) → main window with explicit mode.
            if (typeof b === 'number') {
                return this.applyBackgroundImage(undefined, a, b);
            }
            // (name, path). Mudlet checks label first; only then the console
            // path. Fall through to main when the name is literally "main"
            // (matches setBackgroundColor's special case), default mode 1.
            if (this.session.labels.has(a)) {
                return this.session.labels.setBackgroundImage(a, this.resolveImageUrl(b));
            }
            if (a === 'main') {
                return this.applyBackgroundImage(undefined, b, 1);
            }
            if (this.session.windows.has(a)) {
                return this.session.windows.setBackgroundImage(a, this.resolveImageUrl(b), 1);
            }
            return false;
        }
        // 3 args: (windowName, path, mode).
        if (typeof b !== 'string') return false;
        const mode = Number(c) || 1;
        if (a === 'main') {
            return this.applyBackgroundImage(undefined, b, mode);
        }
        return this.session.windows.setBackgroundImage(a, this.resolveImageUrl(b), mode);
    }

    /**
     * Mudlet `resetBackgroundImage([windowName])`. Without a name (or "main")
     * clears the main window background image; otherwise looks up the named
     * label or window and clears its image. Returns true on success.
     */
    resetBackgroundImage(name?: string): boolean {
        if (!name || name === 'main') {
            useAppStore.getState().patchConnectionProfile(this.connectionId, { outputBackgroundImage: undefined });
            return true;
        }
        if (this.session.labels.has(name)) {
            return this.session.labels.resetBackgroundImage(name);
        }
        return this.session.windows.resetBackgroundImage(name);
    }

    /**
     * Mudlet `setLabelCustomCursor(labelName, cursorPath, [hotX, hotY])`. Points
     * the label's mouse cursor at a custom image. The path is run through the
     * VFS-aware URL resolver (same as setBackgroundImage) so package-relative
     * paths resolve, then composed into a CSS `cursor: url(...) hotX hotY, auto`
     * value. hotX/hotY are the cursor hotspot in pixels (default 0,0). Returns
     * false when the label doesn't exist.
     */
    setLabelCustomCursor(name: string, path: string, hotX?: number, hotY?: number): boolean {
        if (!name || !this.session.labels.has(name)) return false;
        const url = this.resolveImageUrl(path ?? '');
        if (!url) return this.session.labels.setCursor(name, undefined);
        const x = Number.isFinite(hotX) ? Math.max(0, Math.round(hotX as number)) : 0;
        const y = Number.isFinite(hotY) ? Math.max(0, Math.round(hotY as number)) : 0;
        const escaped = url.replace(/"/g, '\\"');
        return this.session.labels.setCursor(name, `url("${escaped}") ${x} ${y}, auto`);
    }

    private applyBackgroundImage(_target: undefined, path: string, mode: number): boolean {
        // Mode 4 is a raw stylesheet body, not an image path — skip the URL
        // resolver so multi-property strings (with their own url(...) refs)
        // are handed to the renderer verbatim, where backgroundImageStyle
        // parses them through the same Qt CSS pipeline as setLabelStyleSheet.
        const url = mode === 4 ? path : this.resolveImageUrl(path);
        useAppStore.getState().patchConnectionProfile(this.connectionId, { outputBackgroundImage: { url, mode } });
        return true;
    }

    /** Runs `path` through the active VFS-aware CSS rewriter so package paths
     *  (e.g. `MyPackage/bg.png`) resolve to vfs:// URLs the renderer can load.
     *  Absolute http(s):/data:/blob: URIs pass through untouched. */
    private resolveImageUrl(path: string): string {
        if (!this.cssRewriter || !path) return path;
        const escaped = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const rewritten = this.cssRewriter(`url("${escaped}")`);
        const m = /url\(\s*"([^"]*)"\s*\)/.exec(rewritten);
        return m ? m[1] : path;
    }

    // ── Borders ───────────────────────────────────────────────────────────────
    // Mudlet setBorderTop/Bottom/Left/Right carve pixel insets out of the main
    // window so labels can sit in the freed space. Sizes are clamped to >= 0
    // and rounded; non-finite input is rejected. Reads/writes the active
    // profile's outputBorders override.

    setBorderTop(size: number): void { this.patchBorders('top', size); }
    setBorderBottom(size: number): void { this.patchBorders('bottom', size); }
    setBorderLeft(size: number): void { this.patchBorders('left', size); }
    setBorderRight(size: number): void { this.patchBorders('right', size); }

    /**
     * Mudlet setBorderSizes — CSS-shorthand-style overloads:
     *   1 arg  → uniform                 (all = a)
     *   2 args → (vertical, horizontal)  (top=bottom=a, left=right=b)
     *   3 args → (top, horizontal, bot)  (left=right=b)
     *   4 args → CSS top/right/bottom/left
     * Other arities no-op (matches Mudlet's silent reject).
     */
    setBorderSizes(a?: number, b?: number, c?: number, d?: number): void {
        const A = this.normalizeBorder(a);
        const B = this.normalizeBorder(b);
        const C = this.normalizeBorder(c);
        const D = this.normalizeBorder(d);
        let t: number | null | undefined, r: number | null | undefined,
            bo: number | null | undefined, l: number | null | undefined;
        if (b === undefined && c === undefined && d === undefined) {
            t = r = bo = l = A;
        } else if (c === undefined && d === undefined) {
            t = bo = A; r = l = B;
        } else if (d === undefined) {
            t = A; r = l = B; bo = C;
        } else {
            t = A; r = B; bo = C; l = D;
        }
        if (t == null || r == null || bo == null || l == null) return;
        useAppStore.getState().patchConnectionProfile(this.connectionId, { outputBorders: { top: t, right: r, bottom: bo, left: l } });
    }

    getBorderTop(): number { return selectProfileField(useAppStore.getState(), this.connectionId, 'outputBorders')?.top ?? 0; }
    getBorderBottom(): number { return selectProfileField(useAppStore.getState(), this.connectionId, 'outputBorders')?.bottom ?? 0; }
    getBorderLeft(): number { return selectProfileField(useAppStore.getState(), this.connectionId, 'outputBorders')?.left ?? 0; }
    getBorderRight(): number { return selectProfileField(useAppStore.getState(), this.connectionId, 'outputBorders')?.right ?? 0; }

    getBorderSizes(): { top: number; right: number; bottom: number; left: number } {
        return selectProfileField(useAppStore.getState(), this.connectionId, 'outputBorders') ?? { top: 0, right: 0, bottom: 0, left: 0 };
    }

    /** Mudlet setBorderColor. Channels are 0..255; alpha defaults to 255. */
    setBorderColor(r: number, g: number, b: number, a = 255): void {
        useAppStore.getState().patchConnectionProfile(this.connectionId, { outputBorderColor: { r, g, b, a } });
    }

    /** Mudlet resetBorderColor — clears the override so the border tracks the page background again. */
    resetBorderColor(): void {
        useAppStore.getState().patchConnectionProfile(this.connectionId, { outputBorderColor: undefined });
    }

    private patchBorders(side: 'top' | 'right' | 'bottom' | 'left', size: number): void {
        const v = this.normalizeBorder(size);
        if (v == null) return;
        const cur = selectProfileField(useAppStore.getState(), this.connectionId, 'outputBorders') ?? { top: 0, right: 0, bottom: 0, left: 0 };
        useAppStore.getState().patchConnectionProfile(this.connectionId, { outputBorders: { ...cur, [side]: v } });
    }

    private normalizeBorder(n: unknown): number | null {
        const num = Number(n);
        if (!Number.isFinite(num)) return null;
        return Math.max(0, Math.round(num));
    }

    /**
     * Mudlet setFont. Without `win` (or "main"), updates the active profile's
     * outputFont so the App-level applyOutputFont effect re-applies the
     * --font-output CSS variable.
     * With a window name, sets the per-window override on WindowManager.
     * Empty `family` clears the override (main → unset, window → inherit).
     */
    setFont(family: string, win?: string): boolean {
        const fam = (family ?? '').trim();
        if (!win || win === 'main') {
            const next = fam ? { kind: 'system' as const, family: fam } : undefined;
            useAppStore.getState().patchConnectionProfile(this.connectionId, { outputFont: next });
            return true;
        }
        return this.session.windows.setFont(win, fam);
    }

    /**
     * Mudlet getFont. Returns the configured font family for the main window
     * (or empty string if none set) or for a specific window. Returns null if
     * the named window doesn't exist.
     */
    getFont(win?: string): string | null {
        if (!win || win === 'main') {
            return selectProfileField(useAppStore.getState(), this.connectionId, 'outputFont')?.family ?? '';
        }
        if (!this.session.windows.has(win)) return null;
        const own = this.session.windows.getFont(win);
        if (own != null) return own;
        return selectProfileField(useAppStore.getState(), this.connectionId, 'outputFont')?.family ?? '';
    }

    /**
     * Mudlet `calcFontSize(window_or_fontsize [, fontname])` — returns the
     * `[width, height]` of an average character cell in pixels. Two overloads:
     *
     *   • `calcFontSize(size [, family])` — measure `family` (or the main
     *     output font when omitted) at `size` px.
     *   • `calcFontSize("WindowName")` — measure the named window/miniconsole
     *     using its configured font+size. Use `"main"` for the main output.
     *
     * Returns `null` when the size is invalid or the named window doesn't
     * exist; the Lua wrapper turns that into Mudlet's `(nil, errMsg)` shape.
     */
    calcFontSize(arg: number | string, fontName?: string): [number, number] | null {
        const mainFamily = (): string =>
            selectProfileField(useAppStore.getState(), this.connectionId, 'outputFont')?.family ?? '';
        const mainSize = (): number =>
            selectProfileField(useAppStore.getState(), this.connectionId, 'fontSize') ?? 12;

        let size: number;
        let family: string;
        if (typeof arg === 'string') {
            if (arg === '') return null;
            if (arg === 'main') {
                size = mainSize();
                family = mainFamily();
            } else {
                if (!this.session.windows.has(arg)) return null;
                size = this.session.windows.getFontSize(arg) ?? mainSize();
                family = this.session.windows.getFont(arg) ?? mainFamily();
            }
        } else {
            size = Number(arg);
            if (!Number.isFinite(size) || size < 1) return null;
            family = fontName && String(fontName).trim() ? String(fontName) : mainFamily();
        }
        return measureMonospaceCell(family, size);
    }

    /**
     * Mudlet `getAvailableFonts()` — set-style table whose keys are font
     * family names usable from scripts. The browser cannot enumerate the
     * system font list without an explicit Local Font Access permission, so
     * this is a best-effort union of what we *do* know:
     *   - Universal web-safe families that work everywhere.
     *   - Every family the FontFaceSet has materialized (URL- or VFS-loaded
     *     fonts go in here once the browser has registered the @font-face).
     *   - The profile's currently configured output font, if any.
     *   - Locally installed system fonts, but only when the user has already
     *     granted Local Font Access in this browser profile — we never prompt
     *     from inside this getter. A silent prime kicks off here so the next
     *     call sees the result.
     */
    getAvailableFonts(): Record<string, boolean> {
        const set: Record<string, boolean> = {};
        for (const f of getUniversalDefaultFonts()) set[f] = true;
        for (const f of getRegisteredFontFamilies()) set[f] = true;
        const current = selectProfileField(useAppStore.getState(), this.connectionId, 'outputFont');
        if (current?.family) set[current.family] = true;
        for (const f of getCachedLocalFonts()) set[f] = true;
        void primeLocalFontsCache();
        return set;
    }

    /** Flush any buffered partial lines to the main output and all open windows. Called after each event dispatch. */
    flushOutput(): void {
        if (!this.isDeferringEcho) {
            const partial = this.mainConsole.currentPartial;
            if (partial.length > 0) this.session.events.emit('message', partial, 'script-partial');
        }
        this.session.windows.flushAllLines();
    }

    /** @deprecated use echo() */
    print(text: string): void {
        this.echo(text);
    }

    printError(text: string, source?: ScriptLogSource): void {
        this.session.events.emit('script.log', text, 'error', source);
    }

    destroy(): void {
        this.flushOutput();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private getConsole(name?: string): Console | null {
        return this.session.consoles.get(name ?? 'main') ?? null;
    }

    /**
     * Whether `windowName` is addressable for text/selection ops. True for the
     * main window, any on-screen window, and off-screen buffers (createBuffer) —
     * all of which back a Console. Used by the read/select methods instead of a
     * bare `windows.has`, which is false for buffers (they have no panel).
     */
    private consoleExists(windowName: string | undefined): boolean {
        if (!windowName || windowName === 'main') return true;
        return this.session.windows.has(windowName) || this.buffers.has(windowName);
    }

    /** Returns the Console for a window, creating and registering one on demand. */
    private outputConsole(win?: string): Console {
        if (!win || win === 'main') return this.mainConsole;
        let con = this.session.consoles.get(win);
        if (!con) {
            con = new Console();
            this.session.consoles.set(win, con);
        }
        return con;
    }

    private drainWindowConsole(win: string, con: Console): void {
        // Off-screen buffers (createBuffer) keep their content in the Console's
        // history only — never push to the WindowManager, which would force a
        // panel open. Drain pending into the void so it can't grow unbounded.
        if (this.buffers.has(win)) {
            con.takeLines();
            return;
        }
        for (const line of con.takeLines()) {
            this.session.windows.pushBuffer(win, line);
        }
        // Also surface the in-flight partial (echo without a trailing \n) so
        // prompts like `echo(win, "Do: ")` actually appear — matches the
        // main-output `script-partial` path. The renderer updates the same
        // DOM element on subsequent partial pushes and finalizes it once a
        // completed line arrives via pushBuffer.
        const partial = con.currentPartial;
        if (partial.length > 0) this.session.windows.pushPartialBuffer(win, partial);
    }

    private resolveBuffer(windowName: string | undefined): AnsiAwareBuffer | null {
        return this.getConsole(windowName)?.getBuffer() ?? null;
    }

    private selectionMatches(win: string | undefined): boolean {
        if (!this.selection) return false;
        const selMain = !this.selection.windowName || this.selection.windowName === 'main';
        const argMain = !win || win === 'main';
        if (selMain && argMain) return true;
        return this.selection.windowName === win;
    }

    private applyStateToSelection(state: FormatStateSnapshot | null): void {
        if (!this.selection || !state) return;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return;
        buf.applyFormat([sel.start, sel.start + sel.length], state);
        // Only rerender if already in the DOM (post-trigger path).
        if (!this.inTriggerProcessing) buf.rerender();
    }

    private drainMain(): void {
        for (const line of this.mainConsole.takeLines()) {
            if (this.isDeferringEcho) {
                this.echoDeferred.push(line);
            } else {
                this.session.events.emit('message', line, 'script');
            }
        }
    }
}
