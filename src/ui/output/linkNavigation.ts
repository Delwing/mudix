/**
 * Keyboard navigation and activation for output hyperlinks — OSC 8, MXP, and
 * scripted links alike (Mudlet's Ctrl+] / Ctrl+[ plus Enter/Space activation).
 *
 * Ctrl+] focuses the next clickable link in the output, Ctrl+[ the previous,
 * wrapping at the ends. With nothing focused, Ctrl+] starts at the first link
 * and Ctrl+[ at the last. Links are made focusable (`tabIndex = -1`) by the
 * renderer, so they take focus programmatically without joining the Tab order.
 *
 * With a link focused: Enter/Space activates it (same as a left-click — fires
 * the send/prompt/url action, reveals a spoiler, toggles selection, arms
 * visibility); the Menu key or Shift+F10 opens its context menu. Mirrors
 * Mudlet's TTextEdit key handling.
 */

const LINK_SELECTOR = '[data-output-clickable]';

/**
 * One representative element per logical link under `root`, in document order.
 * A multicolour link is rendered as several spans (one per colour run) sharing
 * a `data-link-group` key — only the first run of each group is a navigation
 * stop, so Ctrl+]/Ctrl+[ moves link-to-link, not run-to-run. Concealed (hidden)
 * links are skipped.
 */
export function navigableLinks(root: ParentNode): HTMLElement[] {
    const out: HTMLElement[] = [];
    const seen = new Set<string>();
    for (const el of root.querySelectorAll<HTMLElement>(LINK_SELECTOR)) {
        if (el.style.visibility === 'hidden') continue;
        const key = el.dataset.linkGroup;
        if (key !== undefined) {
            if (seen.has(key)) continue; // a later run of an already-seen link
            seen.add(key);
        }
        out.push(el);
    }
    return out;
}

/** Move focus to the link `dir` steps from the currently-focused one (wrapping).
 *  Returns the newly-focused link, or null when there are no links. */
export function focusAdjacentLink(root: ParentNode, dir: 1 | -1): HTMLElement | null {
    const links = navigableLinks(root);
    if (links.length === 0) return null;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? links.indexOf(active) : -1;
    const next = idx === -1
        ? (dir === 1 ? 0 : links.length - 1)
        : (idx + dir + links.length) % links.length;
    links[next].focus();
    return links[next];
}

/** The currently-focused link element under `root`, or null. */
function focusedLink(root: ParentNode): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.matches(LINK_SELECTOR) && root.contains(active)
        ? active
        : null;
}

/** Handle a keydown for link navigation/activation. Returns true when it acted. */
export function handleLinkNavKeydown(e: KeyboardEvent, root: ParentNode): boolean {
    // Ctrl/Cmd+] / Ctrl/Cmd+[ — move between links.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (e.key === ']') { e.preventDefault(); focusAdjacentLink(root, 1); return true; }
        if (e.key === '[') { e.preventDefault(); focusAdjacentLink(root, -1); return true; }
    }

    // Interaction with the focused link. Skip if something already handled this
    // key (e.g. a spoiler's own Enter/Space reveal handler called preventDefault).
    if (e.defaultPrevented) return false;
    const link = focusedLink(root);
    if (!link) return false;

    // Enter/Space — activate, exactly like a left-click (reuses the element's
    // click handlers: spoiler reveal, send/prompt/url, selection, visibility).
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        link.click();
        return true;
    }
    // Menu key / Shift+F10 — open the link's context menu at its position.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        const r = link.getBoundingClientRect();
        link.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: Math.round(r.left), clientY: Math.round(r.bottom),
        }));
        return true;
    }
    return false;
}

/** Install the link navigation/activation key listener for `root`. Returns a remover. */
export function installLinkNavigation(root: ParentNode): () => void {
    const handler = (e: KeyboardEvent): void => { handleLinkNavKeydown(e, root); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
