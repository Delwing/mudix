import { describe, it, expect } from 'vitest';
import { focusTrapTarget } from '../../src/ui/components/useModalFocus';

// focusTrapTarget is the decision behind the dialog Tab trap: given the
// focusable items, the active element, and Shift, it returns where focus should
// jump to stay inside (wrapping at the ends), or null to let the browser move
// focus normally. Tested with plain elements (no layout needed).

function items(n: number): HTMLElement[] {
    return Array.from({ length: n }, () => document.createElement('button'));
}

describe('focusTrapTarget', () => {
    it('returns null when there are no focusable items', () => {
        expect(focusTrapTarget([], null, false)).toBeNull();
    });

    describe('forward (Tab)', () => {
        it('wraps from the last item to the first', () => {
            const it = items(3);
            expect(focusTrapTarget(it, it[2], false)).toBe(it[0]);
        });
        it('lets the browser move when in the middle', () => {
            const it = items(3);
            expect(focusTrapTarget(it, it[1], false)).toBeNull();
        });
        it('pulls focus to the first when it is outside the dialog', () => {
            const it = items(3);
            expect(focusTrapTarget(it, document.createElement('button'), false)).toBe(it[0]);
            expect(focusTrapTarget(it, null, false)).toBe(it[0]);
        });
    });

    describe('backward (Shift+Tab)', () => {
        it('wraps from the first item to the last', () => {
            const it = items(3);
            expect(focusTrapTarget(it, it[0], true)).toBe(it[2]);
        });
        it('lets the browser move when in the middle', () => {
            const it = items(3);
            expect(focusTrapTarget(it, it[1], true)).toBeNull();
        });
        it('pulls focus to the last when it is outside the dialog', () => {
            const it = items(3);
            expect(focusTrapTarget(it, document.createElement('button'), true)).toBe(it[2]);
            expect(focusTrapTarget(it, null, true)).toBe(it[2]);
        });
    });

    it('with a single item, both directions keep focus on it', () => {
        const it = items(1);
        expect(focusTrapTarget(it, it[0], false)).toBe(it[0]); // last → first (itself)
        expect(focusTrapTarget(it, it[0], true)).toBe(it[0]);  // first → last (itself)
    });
});
