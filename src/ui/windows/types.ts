import type { SerializedDockview } from 'dockview';

export type PanelKind = 'output' | 'text' | 'html' | 'map';

export type PanelPosition =
    | 'left'
    | 'right'
    | 'above'
    | 'below'
    | 'within'
    | 'float';

export interface WindowOpenOptions {
    /** Display title shown in the tab. Defaults to the panel id. */
    title?: string;
    /** Panel kind. Defaults to 'text' for script-opened panels. */
    kind?: PanelKind;
    /** Where to place the panel on first open. Ignored once a panel exists. */
    position?: PanelPosition;
    /** Reference panel id for relative positioning. Defaults to 'output'. */
    referencePanelId?: string;
    /** If position === 'float', initial pixel size of the floating window. */
    floatSize?: { width?: number; height?: number };
    /** Bring the panel to the foreground after opening. Defaults to true. */
    activate?: boolean;
}

/**
 * Handle returned to scripts after opening a window. The element is the
 * raw container the script can fill with arbitrary DOM (for `kind: 'html'`)
 * or that text writes are appended to (for `kind: 'text'`).
 */
export interface WindowHandle {
    readonly id: string;
    readonly kind: PanelKind;
    readonly element: HTMLElement;
    write(text: string): void;
    clear(): void;
    setTitle(title: string): void;
    focus(): void;
    close(): void;
}

export type SerializedLayout = SerializedDockview;
