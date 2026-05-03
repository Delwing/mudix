import type { WindowOpenOptions } from '../ui/windows/types';

export interface MudConnection {
    id: string;
    name: string;
    url: string;
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
};

export function connectionUrl(c: MudConnection): string {
    return c.url;
}
