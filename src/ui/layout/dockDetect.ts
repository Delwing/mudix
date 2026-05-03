import type { DockSide } from '../windows/types';

// px from the main-viewport edge that triggers dock creation when no dock exists on that side.
// Only applies to empty sides — sides with an existing dock use bounding-rect detection instead.
const EMPTY_DOCK_ZONE = 80;

/** Detect which dock side the pointer is over and at which slot index to insert. */
export function detectDock(mx: number, my: number): { side: DockSide | null; slotIndex: number } {
    // Existing dock area elements take priority over edge detection.
    for (const side of ['left', 'right', 'top', 'bottom'] as DockSide[]) {
        const el = document.querySelector<HTMLElement>(`.dock-area-${side}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) {
            return { side, slotIndex: slotIndexFromPoint(el, side, mx, my) };
        }
    }
    // Fall back to edge zones of the main viewport — but only for sides that have no
    // existing dock. If a dock already exists on a side but the pointer isn't inside it,
    // we must not trigger via the viewport-edge fallback (its edge coincides with the
    // dock's inner boundary, causing false positives before the pointer reaches the dock).
    const vp = document.querySelector<HTMLElement>('.main-viewport');
    if (vp) {
        const r = vp.getBoundingClientRect();
        if (!document.querySelector('.dock-area-left')   && mx - r.left   < EMPTY_DOCK_ZONE) return { side: 'left',   slotIndex: 0 };
        if (!document.querySelector('.dock-area-right')  && r.right  - mx < EMPTY_DOCK_ZONE) return { side: 'right',  slotIndex: 0 };
        if (!document.querySelector('.dock-area-top')    && my - r.top    < EMPTY_DOCK_ZONE) return { side: 'top',    slotIndex: 0 };
        if (!document.querySelector('.dock-area-bottom') && r.bottom - my < EMPTY_DOCK_ZONE) return { side: 'bottom', slotIndex: 0 };
    }
    return { side: null, slotIndex: 0 };
}

/** Given a pointer inside a DockArea element, find the slot insert index. */
export function slotIndexFromPoint(dockEl: HTMLElement, side: DockSide, mx: number, my: number): number {
    const slots = dockEl.querySelectorAll<HTMLElement>('.dock-panel-slot:not(.dock-panel-slot--preview)');
    const useY  = side === 'left' || side === 'right';
    for (let i = 0; i < slots.length; i++) {
        const r   = slots[i].getBoundingClientRect();
        const mid = useY ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2;
        if ((useY ? my : mx) < mid) return i;
    }
    return slots.length;
}
