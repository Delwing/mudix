import type { DockSide } from '../windows/types';

const EMPTY_DOCK_ZONE = 80;

/**
 * 5-zone drop detection per slot.
 *
 * For a horizontal dock area (top/bottom):
 *   ┌────────────────────────────────┐
 *   │        SPLIT ABOVE 25%         │
 *   ├────┬──────────────────────┬────┤
 *   │bef │      tab stack       │aft │  (middle 50% cross-axis)
 *   │20% │      center 60%      │20% │
 *   ├────┴──────────────────────┴────┤
 *   │        SPLIT BELOW 25%         │
 *   └────────────────────────────────┘
 *
 * Ghost-slot hysteresis: when the cursor is inside the ghost slot that appears
 * on a before/after drop, we merge the ghost + adjacent real panel into one
 * bounding box for zone detection.  This keeps the center/split zones reachable
 * without having to drag all the way across the ghost to reach the shifted panel.
 */
export function detectDock(mx: number, my: number): {
    side: DockSide | null;
    slotIndex: number;
    stackTargetId?: string;
    splitTargetId?: string;
    splitBefore?: boolean;
} {
    for (const side of ['left', 'right', 'top', 'bottom'] as DockSide[]) {
        const el = document.querySelector<HTMLElement>(`.dock-area-${side}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) {
            const info = slotDropInfo(el, side, mx, my);
            return { side, ...info };
        }
    }
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

type DropInfo = {
    slotIndex: number;
    stackTargetId?: string;
    splitTargetId?: string;
    splitBefore?: boolean;
};

function zones(relX: number, relY: number, horizontal: boolean, targetId: string | undefined, slotIndex: number): DropInfo | null {
    const crossRel   = horizontal ? relY : relX;
    const primaryRel = horizontal ? relX : relY;
    if (crossRel < 0.25) return { slotIndex, splitTargetId: targetId, splitBefore: true };
    if (crossRel > 0.75) return { slotIndex, splitTargetId: targetId, splitBefore: false };
    if (primaryRel >= 0.2 && primaryRel <= 0.8) return { slotIndex, stackTargetId: targetId };
    return null; // edge zone on primary axis → fall through to midpoint
}

function slotDropInfo(dockEl: HTMLElement, side: DockSide, mx: number, my: number): DropInfo {
    const realSlots = dockEl.querySelectorAll<HTMLElement>('.dock-panel-slot:not(.dock-panel-slot--preview)');
    const allSlots  = Array.from(dockEl.querySelectorAll<HTMLElement>('.dock-panel-slot'));
    const horizontal = side === 'top' || side === 'bottom';

    // ── Ghost-slot hysteresis ──────────────────────────────────────────────────
    // When the cursor is inside a ghost slot, lock the ghost at its current
    // insert position. Any re-evaluation (merged-box zone detection or Pass-2
    // midpoint logic) creates a feedback loop: the ghost shifts real panels,
    // changing their bounding boxes, yielding a different slotIndex, which
    // moves the ghost, which shifts panels again — visible as rapid flicker.
    // The last-slot ghost never flickers because appending after the last slot
    // shifts nothing; all other positions shift the panels that follow.
    for (let j = 0; j < allSlots.length; j++) {
        if (!allSlots[j].classList.contains('dock-panel-slot--preview')) continue;
        // Inner split-preview ghosts live inside a real slot; skip them.
        // Only outer positional-insert ghosts (direct dock-area children) should
        // lock the slotIndex — inner ones are part of the cross-axis split UI and
        // picking them up here creates the same feedback loop we're fixing.
        if (allSlots[j].closest('.dock-panel-slot:not(.dock-panel-slot--preview)')) continue;
        const gr = allSlots[j].getBoundingClientRect();
        if (mx < gr.left || mx > gr.right || my < gr.top || my > gr.bottom) continue;

        let insertIdx = 0;
        for (let k = 0; k < j; k++) {
            if (!allSlots[k].classList.contains('dock-panel-slot--preview')) insertIdx++;
        }
        return { slotIndex: insertIdx };
    }

    // ── Pass 1: real-slot zone detection ──────────────────────────────────────
    for (let i = 0; i < realSlots.length; i++) {
        const r = realSlots[i].getBoundingClientRect();
        if (mx < r.left || mx > r.right || my < r.top || my > r.bottom) continue;
        const relX = (mx - r.left) / ((r.right  - r.left) || 1);
        const relY = (my - r.top)  / ((r.bottom - r.top)  || 1);
        const tid  = realSlots[i].getAttribute('data-dock-panel') ?? undefined;
        const hit  = zones(relX, relY, horizontal, tid, i);
        if (hit) return hit;
        break; // edge zone → midpoint
    }

    // ── Pass 2: midpoint before/after (ghost-stable) ──────────────────────────
    const primary = horizontal ? mx : my;
    for (let i = 0; i < realSlots.length; i++) {
        const r   = realSlots[i].getBoundingClientRect();
        const mid = horizontal ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2;
        if (primary < mid) return { slotIndex: i };
    }
    return { slotIndex: realSlots.length };
}
