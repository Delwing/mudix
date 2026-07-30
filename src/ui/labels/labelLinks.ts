/**
 * `<a href>` links inside a label's rich text — Mudlet's `TLabel::slot_linkActivated`
 * (src/TLabel.cpp).
 *
 * Geyser packages build clickable UI by echoing anchors into a label:
 *
 *   myLabel:echo([[<a href="send:help topics">Help</a>]])
 *
 * and the href's scheme decides what a click does. The rules deliberately differ
 * from the OSC 8 links the main window renders (`classifyHyperlinkUri`):
 *
 * - a scheme-less href is **Lua source** to run, not a dropped link;
 * - only `send:`, `prompt:`, `http:` and `https:` are recognised (no `ftp:`);
 * - the payload is **not** percent-decoded — Qt hands `linkActivated` the href
 *   verbatim, so `send:cast fireball` reaches the MUD with its literal space.
 *
 * Any other scheme is ignored rather than falling through to the Lua branch,
 * which is what stops a `javascript:`/`file:`/`data:` href from executing.
 */

export type LabelLinkAction =
    | { kind: 'send'; command: string }
    | { kind: 'prompt'; command: string }
    | { kind: 'url'; url: string }
    /** No scheme at all — the whole href is a Lua chunk. */
    | { kind: 'lua'; code: string };

/**
 * Classify a label link href. Returns null when the link does nothing (empty,
 * or an unrecognised scheme).
 *
 * Like Mudlet, the split is on the first `:` rather than an RFC 3986 scheme
 * match — so a scheme-less chunk that happens to contain a colon
 * (`myTable:method()`) is treated as an unknown scheme and ignored.
 */
export function classifyLabelLink(href: string): LabelLinkAction | null {
    if (!href) return null;
    const colon = href.indexOf(':');
    if (colon > 0) {
        const scheme = href.slice(0, colon).toLowerCase(); // RFC 3986: case-insensitive
        const payload = href.slice(colon + 1);
        switch (scheme) {
            case 'send': return { kind: 'send', command: payload };
            case 'prompt': return { kind: 'prompt', command: payload };
            case 'http':
            case 'https': return { kind: 'url', url: href };
            default: return null;
        }
    }
    return { kind: 'lua', code: href };
}

/**
 * The href of the anchor an event target sits inside, or null when the click
 * didn't land on a link.
 *
 * Read through `getAttribute` on purpose: the `.href` *property* resolves the
 * value against the page URL and percent-encodes it, which would turn
 * `send:help topics` into `send:help%20topics` and mangle the command.
 */
export function labelLinkHref(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    return target.closest('a[href]')?.getAttribute('href') ?? null;
}
