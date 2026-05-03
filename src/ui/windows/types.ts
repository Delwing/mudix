export type PanelKind = 'output' | 'text' | 'html' | 'map';

export type DockSide = 'left' | 'right' | 'top' | 'bottom';

export interface DragState {
    panelId: string;
    potentialDock: DockSide | null;
    insertSlotIndex: number | null;
}

export interface WindowOpenOptions {
    title?: string;
    kind?: 'text' | 'html' | 'map';
    position?: 'right' | 'left' | 'above' | 'below';
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    activate?: boolean;
    autoOpen?: boolean;
    docked?: DockSide;
    dockOrder?: number;
    dockFlex?: number;
    /** If false, skip restoring the saved hint (Mudlet restoreLayout=false). */
    ignoreHint?: boolean;
    /** If false, force floating regardless of dockingArea (Mudlet autoDock=false). */
    autoDock?: boolean;
    /** Dock side to use when no saved hint exists (Mudlet dockingArea). "main" = floating. */
    dockingArea?: string;
}

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

export interface ScriptWindowRenderData {
    id: string;
    title: string;
    kind: 'text' | 'html' | 'map';
    visible: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    docked?: DockSide;
    dockOrder?: number;
    dockFlex?: number;
}
