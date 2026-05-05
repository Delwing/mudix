export type GaugeOrientation = 'horizontal' | 'vertical' | 'goofy' | 'batty';

export interface GaugeCreateOptions {
    /** Parent window id ('main' for main viewport). Defaults to 'main'. */
    parent?: string;
    width: number;
    height: number;
    x: number;
    y: number;
    /** Initial gauge text (HTML allowed). */
    text?: string;
    r?: number;
    g?: number;
    b?: number;
    orientation?: GaugeOrientation;
}

export interface GaugeState {
    name: string;
    parent: string;
    x: number;
    y: number;
    width: number;
    height: number;
    r: number;
    g: number;
    b: number;
    /** HTML string rendered inside the text overlay. */
    html: string;
    /** 0..1 fill ratio. */
    value: number;
    orientation: GaugeOrientation;
    visible: boolean;
    cssBack?: string;
    cssFront?: string;
    cssText?: string;
}

type Listener = (gauges: GaugeState[]) => void;

export class GaugeManager {
    private readonly gauges = new Map<string, GaugeState>();
    private readonly listeners = new Map<string, Set<Listener>>();

    create(name: string, opts: GaugeCreateOptions): void {
        const parent = opts.parent ?? 'main';
        // Mudlet default — gray when no color is supplied.
        const r = opts.r ?? 128;
        const g = opts.g ?? 128;
        const b = opts.b ?? 128;
        const state: GaugeState = {
            name, parent,
            x: opts.x, y: opts.y,
            width: opts.width, height: opts.height,
            r, g, b,
            html: opts.text ?? '',
            value: 1,
            orientation: opts.orientation ?? 'horizontal',
            visible: true,
        };
        // If a gauge with this name already exists in a different parent,
        // notify the old parent so its overlay drops the stale entry.
        const prev = this.gauges.get(name);
        this.gauges.set(name, state);
        if (prev && prev.parent !== parent) this.notify(prev.parent);
        this.notify(parent);
    }

    setValue(name: string, current: number, max: number, html?: string): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        const ratio = max === 0 ? 0 : current / max;
        gauge.value = Math.max(0, Math.min(1, ratio));
        if (html !== undefined) gauge.html = html;
        this.notify(gauge.parent);
    }

    setText(name: string, html: string): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        gauge.html = html;
        this.notify(gauge.parent);
    }

    setColor(name: string, r: number, g: number, b: number): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        gauge.r = r; gauge.g = g; gauge.b = b;
        this.notify(gauge.parent);
    }

    move(name: string, x: number, y: number): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        gauge.x = x; gauge.y = y;
        this.notify(gauge.parent);
    }

    resize(name: string, width: number, height: number): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        gauge.width = width; gauge.height = height;
        this.notify(gauge.parent);
    }

    show(name: string): void {
        const gauge = this.gauges.get(name);
        if (!gauge || gauge.visible) return;
        gauge.visible = true;
        this.notify(gauge.parent);
    }

    hide(name: string): void {
        const gauge = this.gauges.get(name);
        if (!gauge || !gauge.visible) return;
        gauge.visible = false;
        this.notify(gauge.parent);
    }

    destroy(name: string): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        this.gauges.delete(name);
        this.notify(gauge.parent);
    }

    setStyleSheet(name: string, cssFront?: string, cssBack?: string, cssText?: string): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        gauge.cssFront = cssFront;
        gauge.cssBack  = cssBack;
        gauge.cssText  = cssText;
        this.notify(gauge.parent);
    }

    setParent(name: string, parent: string, x?: number, y?: number): void {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        const oldParent = gauge.parent;
        gauge.parent = parent;
        if (x !== undefined) gauge.x = x;
        if (y !== undefined) gauge.y = y;
        if (oldParent !== parent) this.notify(oldParent);
        this.notify(parent);
    }

    has(name: string): boolean {
        return this.gauges.has(name);
    }

    list(parent: string): GaugeState[] {
        const out: GaugeState[] = [];
        for (const g of this.gauges.values()) if (g.parent === parent) out.push(g);
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
        for (const g of this.gauges.values()) parents.add(g.parent);
        this.gauges.clear();
        for (const p of parents) this.notify(p);
    }

    private notify(parent: string): void {
        const set = this.listeners.get(parent);
        if (!set) return;
        const list = this.list(parent);
        for (const fn of set) fn(list);
    }
}
