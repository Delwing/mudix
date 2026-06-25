import { useEffect, useRef } from 'react';

/**
 * Modal focus management — the keyboard/AT behaviour Qt gives Mudlet's dialogs
 * for free but the DOM does not: move focus into the dialog on open, trap Tab
 * inside it, close on Escape, and restore focus to the opener on close.
 *
 * Pair with `role="dialog"`/`aria-modal="true"` on the same element (which tells
 * a screen reader to ignore the background). Attach the returned ref to the
 * dialog's root element:
 *
 *   const ref = useModalFocus<HTMLDivElement>(onClose);
 *   return <div className="modal" role="dialog" aria-modal="true" ref={ref}>…</div>;
 */

// Tab-order candidates. [tabindex="-1"] is programmatically focusable but not a
// Tab stop, so it's excluded from the cycle.
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Visible (Tab-reachable) focusable descendants of `container`, in DOM order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        // offsetParent is null for display:none elements (and fixed ones, but
        // dialogs aren't position:fixed descendants here) — skip hidden controls.
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Where a Tab/Shift+Tab should send focus to keep it inside the dialog, or null
 * to let the browser move focus normally (the common case, mid-list). Wraps at
 * the ends and pulls focus back in if it has escaped the dialog. Pure — the
 * caller reads the return and focuses it. Exported for testing.
 */
export function focusTrapTarget(
    items: HTMLElement[],
    active: HTMLElement | null,
    shiftKey: boolean,
): HTMLElement | null {
    if (items.length === 0) return null;
    const first = items[0];
    const last = items[items.length - 1];
    const inside = active != null && items.includes(active);
    if (shiftKey) {
        // Backward from the first (or from outside) wraps to the last.
        return !inside || active === first ? last : null;
    }
    // Forward from the last (or from outside) wraps to the first.
    return !inside || active === last ? first : null;
}

export function useModalFocus<T extends HTMLElement = HTMLDivElement>(
    onClose?: () => void,
): React.RefObject<T | null> {
    const ref = useRef<T | null>(null);
    // Keep the latest onClose without re-running the setup effect (which would
    // re-grab focus on every parent render).
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;
        const opener = document.activeElement as HTMLElement | null;

        // Move focus in: first focusable control, else the dialog itself (made
        // programmatically focusable so the screen reader lands on it).
        const initial = focusableWithin(node)[0] ?? node;
        if (initial === node && !node.hasAttribute('tabindex')) node.tabIndex = -1;
        initial.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onCloseRef.current?.();
                return;
            }
            if (e.key !== 'Tab') return;
            const items = focusableWithin(node);
            const target = focusTrapTarget(items, document.activeElement as HTMLElement | null, e.shiftKey);
            if (items.length === 0) { e.preventDefault(); node.focus(); return; }
            if (target) { e.preventDefault(); target.focus(); }
        };
        node.addEventListener('keydown', onKeyDown);

        return () => {
            node.removeEventListener('keydown', onKeyDown);
            // Restore focus to the opener if it's still in the document.
            if (opener && document.contains(opener)) opener.focus();
        };
    }, []);

    return ref;
}
