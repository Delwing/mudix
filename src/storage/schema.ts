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

export interface AppSchema {
    connections: MudConnection[];
    ui: UISettings;
}

export const APP_DEFAULTS: AppSchema = {
    connections: [],
    ui: {
        showTimestamps: false,
        showMessageTypes: false,
        fontSize: 13,
        stickyLines: 5,
    },
};

export function connectionUrl(c: MudConnection): string {
    return c.url;
}
