import type { SerializedLayout } from '../ui/windows/types';

export interface MudConnection {
    id: string;
    name: string;
    url: string;
}

export interface UISettings {
    showTimestamps: boolean;
    showMessageTypes: boolean;
    fontSize: number;
    stickyLines: number;
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

export interface AppSchema {
    connections: MudConnection[];
    ui: UISettings;
    connectionLayouts: Record<string, SerializedLayout>;
    connectionScripts: Record<string, Script[]>;
    connectionAliases: Record<string, PermanentAlias[]>;
    connectionTriggers: Record<string, PermanentTrigger[]>;
}

export const APP_DEFAULTS: AppSchema = {
    connections: [],
    ui: {
        showTimestamps: false,
        showMessageTypes: false,
        fontSize: 13,
        stickyLines: 5,
    },
    connectionLayouts: {},
    connectionScripts: {},
    connectionAliases: {},
    connectionTriggers: {},
};

export function connectionUrl(c: MudConnection): string {
    return c.url;
}
