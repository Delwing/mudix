export interface LabelCreateOptions {
    /** Parent window id ('main' for main viewport). Defaults to 'main'. */
    parent?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Whether to draw the label's background fill. */
    fillBackground: boolean;
    /** Whether clicks pass through to whatever is underneath. */
    clickThrough?: boolean;
}

export interface LabelState {
    name: string;
    parent: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fillBackground: boolean;
    clickThrough: boolean;
    visible: boolean;
    /** Inner HTML content set via echo()/setLabelText. */
    html: string;
    /** rgba 0..255 channels; alpha defaults to 255 when set via setBackgroundColor. */
    backgroundColor?: { r: number; g: number; b: number; a: number };
    /** Mudlet setBackgroundImage(labelName, imageLocation) — resolved CSS URL.
     *  Labels have no `mode` (unlike consoles); always rendered as a centered
     *  no-repeat background, matching Mudlet's QLabel default. */
    backgroundImage?: { url: string };
    /** Qt-style CSS string set via setLabelStyleSheet; parsed at render time. */
    styleSheet?: string;
    /** Click handler installed by setLabelClickCallback. The event table mirrors
     *  Mudlet's `mudlet.mouse_button` shape: `{button, x, y, alt, ctrl, shift, meta}`. */
    onClick?: (event: LabelMouseEvent) => void;
    /** Pointer down (Mudlet release callback fires on mouseup; press is implicit). */
    onMouseDown?: (event: LabelMouseEvent) => void;
    /** Pointer up — Mudlet setLabelReleaseCallback. */
    onMouseUp?: (event: LabelMouseEvent) => void;
    /** Double-click — Mudlet setLabelDoubleClickCallback. */
    onDoubleClick?: (event: LabelMouseEvent) => void;
    /** Pointer move — Mudlet setLabelMoveCallback. */
    onMouseMove?: (event: LabelMouseEvent) => void;
    /** Wheel — Mudlet setLabelWheelCallback. event.angleDelta carries the scroll. */
    onWheel?: (event: LabelWheelEvent) => void;
    /** Pointer enter — Mudlet setLabelOnEnter. */
    onMouseEnter?: (event: LabelMouseEvent) => void;
    /** Pointer leave — Mudlet setLabelOnLeave. */
    onMouseLeave?: (event: LabelMouseEvent) => void;
    /** Tooltip text rendered via the title attribute. */
    tooltip?: string;
    /** CSS cursor value (e.g. 'pointer', 'crosshair', 'none'). */
    cursor?: string;
    /** z-index applied to the label DIV. Higher = on top of other labels. */
    zIndex?: number;
}

/** Event payload for label mouse callbacks. Mirrors Mudlet's button-int convention
 *  (1=left, 2=right, 4=middle) so ported scripts can read `event.button` directly. */
export interface LabelMouseEvent {
    button: number;
    x: number;
    y: number;
    globalX: number;
    globalY: number;
    alt: boolean;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
}

export interface LabelWheelEvent extends LabelMouseEvent {
    /** Mudlet exposes wheel deltas via `angleDelta.x` / `angleDelta.y` (Qt naming). */
    angleDelta: { x: number; y: number };
}

type Listener = (labels: LabelState[]) => void;

// Lua callers can pass nil or percentage strings ("12.5%") through createLabel /
// moveWindow / resizeWindow — `Number(...)` then yields NaN, which React would
// emit as `left: NaN` and warn about. Coerce non-finite inputs to 0 so the
// label still renders (matches Mudlet's int-cast behaviour) instead of
// poisoning the inline style.
function safeCoord(n: number): number {
    return Number.isFinite(n) ? n : 0;
}

export class LabelManager {
    private readonly labels = new Map<string, LabelState>();
    private readonly listeners = new Map<string, Set<Listener>>();
    // Monotonic counters so raise/lowerLabel give predictable ordering across
    // many calls without ever colliding. Starts mid-range to leave headroom.
    private nextRaiseZ = 1000;
    private nextLowerZ = -1;

    /** Returns true if a new label was created. Mudlet's createLabel returns
     *  false when a label with the same name already exists. */
    create(name: string, opts: LabelCreateOptions): boolean {
        if (this.labels.has(name)) return false;
        const parent = opts.parent ?? 'main';
        const state: LabelState = {
            name, parent,
            x: safeCoord(opts.x), y: safeCoord(opts.y),
            width: safeCoord(opts.width), height: safeCoord(opts.height),
            fillBackground: opts.fillBackground,
            clickThrough: opts.clickThrough ?? false,
            visible: true,
            html: '',
        };
        this.labels.set(name, state);
        this.notify(parent);
        return true;
    }

    has(name: string): boolean {
        return this.labels.has(name);
    }

    destroy(name: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        this.labels.delete(name);
        this.notify(lbl.parent);
        return true;
    }

    move(name: string, x: number, y: number): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.x = safeCoord(x); lbl.y = safeCoord(y);
        this.notify(lbl.parent);
        return true;
    }

    resize(name: string, width: number, height: number): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.width = safeCoord(width); lbl.height = safeCoord(height);
        this.notify(lbl.parent);
        return true;
    }

    show(name: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        if (!lbl.visible) { lbl.visible = true; this.notify(lbl.parent); }
        return true;
    }

    hide(name: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        if (lbl.visible) { lbl.visible = false; this.notify(lbl.parent); }
        return true;
    }

    setHtml(name: string, html: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.html = html;
        this.notify(lbl.parent);
        return true;
    }

    setBackgroundColor(name: string, r: number, g: number, b: number, a = 255): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.backgroundColor = { r, g, b, a };
        // Mudlet implicitly enables fill when the user sets a bg color.
        lbl.fillBackground = true;
        this.notify(lbl.parent);
        return true;
    }

    getBackgroundColor(name: string): { r: number; g: number; b: number; a: number } | null {
        return this.labels.get(name)?.backgroundColor ?? null;
    }

    setBackgroundImage(name: string, url: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.backgroundImage = { url };
        this.notify(lbl.parent);
        return true;
    }

    resetBackgroundImage(name: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.backgroundImage = undefined;
        this.notify(lbl.parent);
        return true;
    }

    setStyleSheet(name: string, css: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.styleSheet = css;
        this.notify(lbl.parent);
        return true;
    }

    /** Mudlet `getLabelStyleSheet(name)` — the Qt-style CSS last set via
     *  {@link setStyleSheet}, or `""` when none is set. Returns `undefined`
     *  when the label doesn't exist so the caller can distinguish that case. */
    getStyleSheet(name: string): string | undefined {
        const lbl = this.labels.get(name);
        if (!lbl) return undefined;
        return lbl.styleSheet ?? '';
    }

    setClickCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onClick = fn;
        this.notify(lbl.parent);
        return true;
    }

    setMouseUpCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onMouseUp = fn;
        this.notify(lbl.parent);
        return true;
    }

    setDoubleClickCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onDoubleClick = fn;
        this.notify(lbl.parent);
        return true;
    }

    setMouseMoveCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onMouseMove = fn;
        this.notify(lbl.parent);
        return true;
    }

    setWheelCallback(name: string, fn: ((e: LabelWheelEvent) => void) | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onWheel = fn;
        this.notify(lbl.parent);
        return true;
    }

    setMouseEnterCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onMouseEnter = fn;
        this.notify(lbl.parent);
        return true;
    }

    setMouseLeaveCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onMouseLeave = fn;
        this.notify(lbl.parent);
        return true;
    }

    setTooltip(name: string, text: string | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.tooltip = text && text.length > 0 ? text : undefined;
        this.notify(lbl.parent);
        return true;
    }

    setClickThrough(name: string, value: boolean): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        if (lbl.clickThrough !== value) {
            lbl.clickThrough = value;
            this.notify(lbl.parent);
        }
        return true;
    }

    setCursor(name: string, cursor: string | undefined): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.cursor = cursor;
        this.notify(lbl.parent);
        return true;
    }

    raise(name: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.zIndex = this.nextRaiseZ++;
        this.notify(lbl.parent);
        return true;
    }

    lower(name: string): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.zIndex = this.nextLowerZ--;
        this.notify(lbl.parent);
        return true;
    }

    list(parent: string): LabelState[] {
        const out: LabelState[] = [];
        for (const l of this.labels.values()) if (l.parent === parent) out.push(l);
        return out;
    }

    subscribe(parent: string, fn: Listener): () => void {
        let set = this.listeners.get(parent);
        if (!set) { set = new Set(); this.listeners.set(parent, set); }
        set.add(fn);
        fn(this.list(parent));
        return () => {
            set!.delete(fn);
            if (set!.size === 0) this.listeners.delete(parent);
        };
    }

    clearAll(): void {
        const parents = new Set<string>();
        for (const l of this.labels.values()) parents.add(l.parent);
        this.labels.clear();
        for (const p of parents) this.notify(p);
    }

    private notify(parent: string): void {
        const set = this.listeners.get(parent);
        if (!set) return;
        const list = this.list(parent);
        for (const fn of set) fn(list);
    }
}
