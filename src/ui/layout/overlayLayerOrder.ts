/**
 * Shared z-order across the four kinds of per-parent overlay content: nested
 * windows/mini-consoles (including the embedded mapper), labels, overlay
 * command lines, and scroll boxes.
 *
 * In real Mudlet these are all Geyser widgets living in one Qt widget stack —
 * raiseWindow/lowerWindow (and simply adding a widget after another) reorders
 * freely across types. mudix instead renders each kind into its own wrapper
 * layer per parent viewport (FloatingWindowLayer's nested root, LabelOverlay,
 * CommandLineOverlay, ScrollBoxOverlay), each historically pinned to a fixed
 * CSS z-index band (windows below labels below cmd-lines below scroll boxes).
 * That band makes it impossible for e.g. an embedded mapper to ever render
 * above a sibling label, even when a script explicitly calls
 * raiseWindow("mapper") — the Mudlet-standard way Geyser.Mapper keeps itself
 * above decorative frame labels.
 *
 * This registry tracks, per parent id, which kind was most recently
 * created/reparented/raised/lowered, so those wrapper layers can compute a
 * genuinely comparable inline z-index instead of the fixed band. Untouched
 * kinds keep today's default relative order (BASE_RANK) so nothing shifts
 * until a script actually interacts with one of them — preserving the fix
 * for a plain nested console's scrolling text never being explicitly raised
 * still sitting below its parent's labels by default.
 *
 * getZ() deliberately returns a small ordinal (0..KINDS.length-1), NOT the
 * raw monotonic touch sequence — the sequence grows unboundedly over a
 * session (every raiseWindow/lowerWindow call, including the ones Geyser
 * fires on every container reflow, bumps it), and encoding it directly into
 * a CSS z-index risks it eventually exceeding fixed "always on top" bands
 * elsewhere in the app (e.g. the map's right-click menu at z:1000) — which
 * did happen once during development, with the map's own canvas ending up
 * on top of its own context menu. Ranking into a tiny fixed range keeps this
 * registry's output permanently below any realistic app-wide z-index band.
 */
export type OverlayLayerKind = 'windows' | 'labels' | 'cmdlines' | 'scrollboxes';

const BASE_RANK: Record<OverlayLayerKind, number> = {
    windows: 0,
    labels: 1,
    cmdlines: 2,
    scrollboxes: 3,
};

const KINDS = Object.keys(BASE_RANK) as OverlayLayerKind[];

type Listener = () => void;

export class OverlayLayerOrder {
    private seq = 0;
    private ranks = new Map<string, Partial<Record<OverlayLayerKind, number>>>();
    private listeners = new Map<string, Set<Listener>>();

    /** Record that `kind` was just created/reparented/raised/lowered under `parentId`. */
    touch(parentId: string, kind: OverlayLayerKind): void {
        let m = this.ranks.get(parentId);
        if (!m) { m = {}; this.ranks.set(parentId, m); }
        m[kind] = ++this.seq;
        for (const fn of this.listeners.get(parentId) ?? []) fn();
    }

    /** Bounded z-index (0..KINDS.length-1) for `kind`'s wrapper layer under
     *  `parentId` — its rank among the 4 kinds by most-recent touch, with
     *  untouched kinds falling back to BASE_RANK order below any touched one. */
    getZ(parentId: string, kind: OverlayLayerKind): number {
        const touched = this.ranks.get(parentId) ?? {};
        const order = KINDS.slice().sort((a, b) => {
            const ta = touched[a], tb = touched[b];
            if (ta == null && tb == null) return BASE_RANK[a] - BASE_RANK[b];
            if (ta == null) return -1;
            if (tb == null) return 1;
            return ta - tb;
        });
        return order.indexOf(kind);
    }

    /** Re-render trigger for a parent's overlay wrapper components. */
    subscribe(parentId: string, cb: Listener): () => void {
        let set = this.listeners.get(parentId);
        if (!set) { set = new Set(); this.listeners.set(parentId, set); }
        set.add(cb);
        return () => {
            set!.delete(cb);
            if (set!.size === 0) this.listeners.delete(parentId);
        };
    }
}
