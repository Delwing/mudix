export interface ScrollBoxCreateOptions {
    /** Parent window id ('main' for the main viewport, or a userwindow / another
     *  scroll box name for nesting). */
    parent?: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ScrollBoxState {
    name: string;
    parent: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    /** Raw Qt-style CSS string from a future setScrollBoxStyleSheet — stored for
     *  parity; Geyser.ScrollBox:setStyleSheet is itself unimplemented upstream. */
    styleSheet?: string;
    /** z-index — bumped by raiseWindow / lowerWindow. */
    zIndex?: number;
}

type Listener = (scrollBoxes: ScrollBoxState[]) => void;

function safeCoord(n: number): number {
    return Number.isFinite(n) ? n : 0;
}

/**
 * Registry for overlay scroll-box widgets (Mudlet createScrollBox). A scroll box
 * is an absolutely-positioned, scrollable container on top of a parent viewport
 * that other overlay widgets (labels, command lines, nested scroll boxes) can be
 * created *inside* by passing the box's name as their parent — mirroring
 * Mudlet's Geyser.ScrollBox, which treats the box as its own "window".
 *
 * Shares the per-parent subscriber shape of {@link CommandLineManager} /
 * {@link LabelManager}; the React {@link ScrollBoxOverlay} renders each box and
 * mounts the child overlays scoped to the box's name within its scroll area.
 */
export class ScrollBoxManager {
    private readonly boxes = new Map<string, ScrollBoxState>();
    private readonly listeners = new Map<string, Set<Listener>>();
    private nextRaiseZ = 1000;
    private nextLowerZ = -1;

    /** Mudlet createScrollBox([parent,] name, x, y, w, h) — false when a scroll
     *  box with that name already exists. */
    create(name: string, opts: ScrollBoxCreateOptions): boolean {
        if (this.boxes.has(name)) return false;
        const parent = opts.parent ?? 'main';
        this.boxes.set(name, {
            name, parent,
            x: safeCoord(opts.x), y: safeCoord(opts.y),
            width: safeCoord(opts.width), height: safeCoord(opts.height),
            visible: true,
        });
        this.notify(parent);
        return true;
    }

    has(name: string): boolean {
        return this.boxes.has(name);
    }

    get(name: string): ScrollBoxState | undefined {
        return this.boxes.get(name);
    }

    destroy(name: string): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        this.boxes.delete(name);
        this.notify(sb.parent);
        return true;
    }

    move(name: string, x: number, y: number): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        sb.x = safeCoord(x); sb.y = safeCoord(y);
        this.notify(sb.parent);
        return true;
    }

    resize(name: string, width: number, height: number): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        sb.width = safeCoord(width); sb.height = safeCoord(height);
        this.notify(sb.parent);
        return true;
    }

    show(name: string): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        if (!sb.visible) { sb.visible = true; this.notify(sb.parent); }
        return true;
    }

    hide(name: string): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        if (sb.visible) { sb.visible = false; this.notify(sb.parent); }
        return true;
    }

    raise(name: string): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        sb.zIndex = this.nextRaiseZ++;
        this.notify(sb.parent);
        return true;
    }

    lower(name: string): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        sb.zIndex = this.nextLowerZ--;
        this.notify(sb.parent);
        return true;
    }

    setStyleSheet(name: string, css: string): boolean {
        const sb = this.boxes.get(name);
        if (!sb) return false;
        sb.styleSheet = css && css.trim() ? css : undefined;
        this.notify(sb.parent);
        return true;
    }

    list(parent: string): ScrollBoxState[] {
        const out: ScrollBoxState[] = [];
        for (const sb of this.boxes.values()) if (sb.parent === parent) out.push(sb);
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
        for (const sb of this.boxes.values()) parents.add(sb.parent);
        this.boxes.clear();
        for (const p of parents) this.notify(p);
    }

    private notify(parent: string): void {
        const set = this.listeners.get(parent);
        if (!set) return;
        const list = this.list(parent);
        for (const fn of set) fn(list);
    }
}
