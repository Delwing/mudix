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

export interface Script {
    id: string;
    name: string;
    language: 'lua' | 'js';
    code: string;
    enabled: boolean;
}

export interface PermanentAlias {
    id: string;
    name: string;
    pattern: string;   // regex string
    code: string;
    language: 'lua' | 'js';
    enabled: boolean;
}

export interface PermanentTrigger {
    id: string;
    name: string;
    pattern: string;   // regex string, matched against ANSI-stripped MUD output
    code: string;
    language: 'lua' | 'js';
    enabled: boolean;
}

export interface PermanentTimer {
    id: string;
    name: string;
    seconds: number;
    code: string;
    language: 'lua' | 'js';
    repeat: boolean;
    enabled: boolean;
}

export interface PermanentKeybinding {
    id: string;
    name: string;
    key: string;        // KeyboardEvent.key value, e.g. "F1", "Enter"
    modifiers: string[]; // subset of ["ctrl", "shift", "alt", "meta"]
    code: string;
    language: 'lua' | 'js';
    enabled: boolean;
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
    connectionScripts: Record<string, Script[]>;
    connectionAliases: Record<string, PermanentAlias[]>;
    connectionTriggers: Record<string, PermanentTrigger[]>;
    connectionTimers: Record<string, PermanentTimer[]>;
    connectionKeybindings: Record<string, PermanentKeybinding[]>;
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
