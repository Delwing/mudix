/**
 * Keyboard navigation between OSC 8 hyperlinks (Mudlet's Ctrl+] / Ctrl+[).
 *
 * Ctrl+] focuses the next clickable link in the output, Ctrl+[ the previous,
 * wrapping at the ends. With nothing focused, Ctrl+] starts at the first link
 * and Ctrl+[ at the last. Links are made focusable (`tabIndex = -1`) by the
 * renderer, so they take focus programmatically without joining the Tab order.
 */

const LINK_SELECTOR = '[data-output-clickable]';

/** All navigable (not concealed) link elements under `root`, in document order. */
export function navigableLinks(root: ParentNode): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(LINK_SELECTOR))
        .filter((el) => el.style.visibility !== 'hidden');
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

/** Handle a keydown for the link-nav chords. Returns true when it acted. */
export function handleLinkNavKeydown(e: KeyboardEvent, root: ParentNode): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
    if (e.key === ']') { e.preventDefault(); focusAdjacentLink(root, 1); return true; }
    if (e.key === '[') { e.preventDefault(); focusAdjacentLink(root, -1); return true; }
    return false;
}

/** Install the Ctrl+]/Ctrl+[ link-nav listener for `root`. Returns a remover. */
export function installLinkNavigation(root: ParentNode): () => void {
    const handler = (e: KeyboardEvent): void => { handleLinkNavKeydown(e, root); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
