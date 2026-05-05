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
    /** Click handler installed by setLabelClickCallback. */
    onClick?: () => void;
}

type Listener = (labels: LabelState[]) => void;

export class LabelManager {
    private readonly labels = new Map<string, LabelState>();
    private readonly listeners = new Map<string, Set<Listener>>();

    /** Returns true if a new label was created. Mudlet's createLabel returns
     *  false when a label with the same name already exists. */
    create(name: string, opts: LabelCreateOptions): boolean {
        if (this.labels.has(name)) return false;
        const parent = opts.parent ?? 'main';
        const state: LabelState = {
            name, parent,
            x: opts.x, y: opts.y,
            width: opts.width, height: opts.height,
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
        lbl.x = x; lbl.y = y;
        this.notify(lbl.parent);
        return true;
    }

    resize(name: string, width: number, height: number): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.width = width; lbl.height = height;
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

    setClickCallback(name: string, fn: () => void): boolean {
        const lbl = this.labels.get(name);
        if (!lbl) return false;
        lbl.onClick = fn;
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
