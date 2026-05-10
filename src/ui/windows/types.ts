export type PanelKind = 'output' | 'text' | 'html' | 'map';

export type DockSide = 'left' | 'right' | 'top' | 'bottom';

export interface DragState {
    panelId: string;
    potentialDock: DockSide | null;
    insertSlotIndex: number | null;
    /** Center zone drop — creates/joins a tab group. */
    stackTargetId?: string;
    /** Cross-axis edge drop — creates/joins a split group (vertical stack in horizontal dock). */
    splitTargetId?: string;
    /** true = insert before target in cross-axis; false = after. */
    splitBefore?: boolean;
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
    dockGroup?: string;
    tabOrder?: number;
    isActiveTab?: boolean;
    splitGroup?: string;
    splitOrder?: number;
    splitFlex?: number;
    /** If true, window is restored in hidden state. */
    hidden?: boolean;
    /** If false, skip restoring the saved hint (Mudlet restoreLayout=false). */
    ignoreHint?: boolean;
    /** If false, force floating regardless of dockingArea (Mudlet autoDock=false). */
    autoDock?: boolean;
    /** Dock side to use when no saved hint exists (Mudlet dockingArea). "main" = floating. */
    dockingArea?: string;
    /** Output font size in pixels (Mudlet setFontSize). */
    fontSize?: number;
    /** Output font family override (Mudlet setFont). */
    fontFamily?: string;
    /** Character-column wrap width (Mudlet setWindowWrap). 0/undefined disables. */
    wrapAt?: number;
    /** Window background fill (Mudlet setBackgroundColor). rgba 0..255. */
    backgroundColor?: { r: number; g: number; b: number; a: number };
    /** For miniconsoles, the parent userwindow id ('main' or another userwindow's
     *  name). When set to a non-main parent, the miniconsole is rendered inside
     *  that parent's viewport at parent-relative (x, y) coordinates. */
    parent?: string;
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
    dockGroup?: string;
    tabOrder?: number;
    isActiveTab?: boolean;
    splitGroup?: string;
    splitOrder?: number;
    splitFlex?: number;
    fontSize?: number;
    fontFamily?: string;
    wrapAt?: number;
    backgroundColor?: { r: number; g: number; b: number; a: number };
    /** For miniconsoles created with a parent userwindow — see WindowOpenOptions.parent. */
    parent?: string;
}
