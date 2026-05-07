import type { WindowOpenOptions } from '../ui/windows/types';

export const DEFAULT_PROXY_URL = 'wss://mudix.delwing.workers.dev';

export type ConnectionMode = 'mud' | 'websocket';

export interface MudConnection {
    id: string;
    name: string;
    mode?: ConnectionMode;  // undefined treated as 'websocket' for backward compat
    // websocket mode
    url?: string;
    // mud mode
    host?: string;
    port?: number;
    proxyUrl?: string;      // overrides DEFAULT_PROXY_URL when set
}

export type Theme = 'dark' | 'light' | 'amber' | 'sky';

/**
 * Where the output font came from. `system` is the default — a name typed by
 * the user or chosen from `navigator.fonts.query()`; nothing is registered.
 * `url` injects a `<link rel="stylesheet">` into <head> (e.g. Google Fonts).
 * `vfs` reads font bytes from the active profile's VFS and registers them via
 * the FontFace API. URL/VFS sources need to be re-applied on every page load.
 */
export type OutputFontSource =
    | { kind: 'system'; family: string }
    | { kind: 'url'; family: string; url: string }
    | { kind: 'vfs'; family: string; path: string };

export interface UISettings {
    showTimestamps: boolean;
    fontSize: number;
    stickyLines: number;
    outputBackground: string;
    theme: Theme;
    outputFont?: OutputFontSource;
    /** Mudlet setWindowWrap("main", N). 0/undefined disables character-based wrap. */
    outputWrapAt?: number;
    /** Mudlet setBackgroundColor for the main window. rgba 0..255. Takes precedence over outputBackground when set. */
    outputBackgroundColor?: { r: number; g: number; b: number; a: number };
    /** Mudlet setBorderTop/Bottom/Left/Right. Pixel insets carved from the main window for label placement; 0 / undefined = no border. */
    outputBorders?: { top: number; right: number; bottom: number; left: number };
    /** Mudlet setBorderColor — fill color for the carved border area. rgba 0..255; undefined = inherit page background. */
    outputBorderColor?: { r: number; g: number; b: number; a: number };
}

// ── Tree node base ────────────────────────────────────────────────────────────

interface BaseNode {
    id: string;
    name: string;
    enabled: boolean;
    isGroup: boolean;       // true = folder/group that may contain children
    parentId: string | null; // null = root level
    /** When set, this node was installed by a package; uninstall removes all nodes with the same tag. */
    packageName?: string;
}

// ── Package manifest (Mudlet .mpackage / XML import) ─────────────────────────

export interface PackageManifest {
    name: string;
    version?: string;
    author?: string;
    title?: string;
    description?: string;
    /** Filename of the icon inside the package dir (e.g. "mudlet.png"), as declared in config.lua. */
    icon?: string;
    /** Author-declared creation date from config.lua (free-form string, often ISO-8601). */
    created?: string;
    /** Path of the XML file inside the package directory, relative to <profilePath>/<name>/ */
    xmlPath?: string;
    /** Source filename (e.g. "GenericMapper.mpackage"), useful for display. */
    sourceFile?: string;
    /** Wall-clock install time, ISO-8601. */
    installedAt: string;
}

// ── Item types (mirrors Mudlet's TScript / TAlias / TTrigger / TTimer / TKey) ──

export interface ScriptNode extends BaseNode {
    code: string;
    language: 'lua' | 'js';
    eventHandlers: string[]; // event names this script handles (Mudlet TScript.mEventHandlerList)
}

export interface AliasNode extends BaseNode {
    pattern: string;   // single regex string (Mudlet TAlias.mRegexCode)
    command: string;   // plain command to send (%1..%9 = capture groups); Mudlet TAlias.mCommand
    code: string;
    language: 'lua' | 'js';
}

export type TriggerPatternType =
    | 'substring'
    | 'regex'
    | 'startOfLine'
    | 'exactMatch'
    | 'luaFunction'
    | 'lineSpacer'
    | 'colorTrigger'
    | 'prompt';

export interface TriggerPattern {
    text: string;
    type: TriggerPatternType;
}

export interface TriggerNode extends BaseNode {
    patterns: TriggerPattern[];  // one or more patterns — any match fires (Mudlet TTrigger.mPatterns)
    code: string;
    language: 'lua' | 'js';
    fireLength: number;          // chain length: 0 = only the current line; N = current + N more lines (groups with patterns only)
    multipleMatches: boolean;    // fire once per regex occurrence on a line, not just the first
    multiline: boolean;          // AND mode: all patterns must match in sequence
    delta: number;               // 0 = unlimited; N = max lines from first condition match to last
    isFilter: boolean;           // filter chain: pass captured/matched text to children instead of full line
    highlight?: {                // built-in colorization applied to the matched text
        fg?: string;             // hex color e.g. "#ff0000"
        bg?: string;
    };
    command?: string;            // plain command to send on fire (%1..%9 = capture groups)
}

export interface TimerNode extends BaseNode {
    seconds: number;
    code: string;
    language: 'lua' | 'js';
    repeat: boolean;
    command?: string;    // plain command to send when the timer fires
}

export interface KeyNode extends BaseNode {
    key: string;         // KeyboardEvent.code value, e.g. "F1", "KeyA", "Numpad1"
    modifiers: string[]; // subset of ["ctrl", "shift", "alt", "meta"]
    code: string;
    language: 'lua' | 'js';
    command?: string;    // plain command to send when the keybinding fires
}

export type ButtonLocation = 'top' | 'bottom' | 'left' | 'right' | 'floating';
export type ButtonOrientation = 'horizontal' | 'vertical';

/**
 * Mudlet-style action node. Groups are toolbars; leaves are buttons.
 * Mirrors Mudlet's TAction (mLocation/mOrientation/mPushDownButton/...).
 * `styleSheet` is persisted but not applied yet (no stylesheet support).
 */
export interface ButtonNode extends BaseNode {
    // ── Group fields (toolbar) ──────────────────────────────────────────
    orientation: ButtonOrientation;
    location: ButtonLocation;
    /** Number of columns for the toolbar grid. 0 = auto / single line (Mudlet TToolBar.mButtonColumns). */
    columns: number;
    /** Floating-toolbar geometry (groups with location='floating'). */
    posX?: number;
    posY?: number;
    sizeX?: number;
    sizeY?: number;

    // ── Button fields (leaf) ────────────────────────────────────────────
    /** Two-state (push-down) button. */
    isPushDown: boolean;
    /** Current state for two-state buttons (false = up, true = down). */
    buttonState: boolean;
    /** Path to icon image, relative to the profile VFS root (typically inside a package dir). */
    icon?: string;
    tooltip?: string;

    // ── Actions ─────────────────────────────────────────────────────────
    /** Lua code; runs on every click regardless of state direction (Mudlet TAction.mScript). */
    code: string;
    language: 'lua' | 'js';
    /** Command sent on single-state click OR when a two-state button goes UP (Mudlet commandButtonUp). */
    command?: string;
    /** Command sent only when a two-state button goes DOWN (Mudlet commandButtonDown). */
    commandDown?: string;

    /** Accepted but currently unused — Mudlet stylesheet text. */
    styleSheet?: string;
}

// ── Tree utilities ────────────────────────────────────────────────────────────

/** Returns true if the item and all its ancestors are enabled. */
export function isEffectivelyEnabled<T extends { id: string; enabled: boolean; parentId: string | null }>(
    item: T,
    allItems: T[],
): boolean {
    const byId = new Map(allItems.map(i => [i.id, i]));
    let node: { enabled: boolean; parentId: string | null } | undefined = item;
    while (node) {
        if (!node.enabled) return false;
        if (!node.parentId) break;
        node = byId.get(node.parentId);
    }
    return true;
}

export interface ModalBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ScriptEditorBounds extends ModalBounds {
    listWidth?: number;
    metaHeight?: number;
}

export interface AppSchema {
    connections: MudConnection[];
    ui: UISettings;
    connectionWindowHints: Record<string, Record<string, WindowOpenOptions>>;
    /** Per-connection dock area extents: { left, right, top, bottom } in pixels. */
    connectionDockExtents: Record<string, Record<string, number>>;
    connectionScripts: Record<string, ScriptNode[]>;
    connectionAliases: Record<string, AliasNode[]>;
    connectionTriggers: Record<string, TriggerNode[]>;
    connectionTimers: Record<string, TimerNode[]>;
    connectionKeybindings: Record<string, KeyNode[]>;
    connectionButtons: Record<string, ButtonNode[]>;
    connectionScriptEditorBounds: Record<string, ScriptEditorBounds>;
    connectionModalBounds: Record<string, Record<string, ModalBounds>>;
    connectionPackages: Record<string, PackageManifest[]>;
}

export const APP_DEFAULTS: AppSchema = {
    connections: [],
    ui: {
        showTimestamps: false,
        fontSize: 13,
        stickyLines: 5,
        outputBackground: '',
        theme: 'dark',
    },
    connectionWindowHints: {},
    connectionDockExtents: {},
    connectionScripts: {},
    connectionAliases: {},
    connectionTriggers: {},
    connectionTimers: {},
    connectionKeybindings: {},
    connectionButtons: {},
    connectionScriptEditorBounds: {},
    connectionModalBounds: {},
    connectionPackages: {},
};

export function connectionUrl(c: MudConnection): string {
    if (c.mode === 'mud') {
        const base = (c.proxyUrl?.trim() || DEFAULT_PROXY_URL).replace(/\/$/, '');
        return `${base}?host=${encodeURIComponent(c.host ?? '')}&port=${c.port ?? 23}`;
    }
    return c.url ?? '';
}

export function connectionDisplayAddr(c: MudConnection): string {
    if (c.mode === 'mud') return `${c.host ?? ''}:${c.port ?? 23}`;
    return c.url ?? '';
}
