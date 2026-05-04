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

export interface UISettings {
    showTimestamps: boolean;
    fontSize: number;
    stickyLines: number;
    outputBackground: string;
}

// ── Tree node base ────────────────────────────────────────────────────────────

interface BaseNode {
    id: string;
    name: string;
    enabled: boolean;
    isGroup: boolean;       // true = folder/group that may contain children
    parentId: string | null; // null = root level
}

// ── Item types (mirrors Mudlet's TScript / TAlias / TTrigger / TTimer / TKey) ──

export interface ScriptNode extends BaseNode {
    code: string;
    language: 'lua' | 'js';
    eventHandlers: string[]; // event names this script handles (Mudlet TScript.mEventHandlerList)
}

export interface AliasNode extends BaseNode {
    pattern: string;   // single regex string (Mudlet TAlias.mRegexCode)
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
}

export interface TimerNode extends BaseNode {
    seconds: number;
    code: string;
    language: 'lua' | 'js';
    repeat: boolean;
}

export interface KeyNode extends BaseNode {
    key: string;         // KeyboardEvent.code value, e.g. "F1", "KeyA", "Numpad1"
    modifiers: string[]; // subset of ["ctrl", "shift", "alt", "meta"]
    code: string;
    language: 'lua' | 'js';
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

export interface ScriptEditorBounds {
    x: number;
    y: number;
    width: number;
    height: number;
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
    connectionScriptEditorBounds: Record<string, ScriptEditorBounds>;
}

export const APP_DEFAULTS: AppSchema = {
    connections: [],
    ui: {
        showTimestamps: false,
        fontSize: 13,
        stickyLines: 5,
        outputBackground: '',
    },
    connectionWindowHints: {},
    connectionDockExtents: {},
    connectionScripts: {},
    connectionAliases: {},
    connectionTriggers: {},
    connectionTimers: {},
    connectionKeybindings: {},
    connectionScriptEditorBounds: {},
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
