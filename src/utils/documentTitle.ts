/**
 * Single owner of `document.title`.
 *
 * The tab title is composed from two parts that used to fight over it: a leading
 * connection-status dot (🟢/🟡/🔴, set from React) and the profile label. On top
 * of that sit transient flashes — Mudlet's `alert()` and the "notify on new
 * data" feature. Everything goes through here so there's exactly one blink
 * interval and one set of focus/visibility listeners for the whole app.
 *
 * The flash reuses the *same* status dot rather than adding a second one: while
 * flashing, the leading dot blinks to white `⚪` and back. Both frames are emoji
 * so they share an advance width and the title text never shifts as it blinks.
 * If there's no status dot (connection indicator off) the flash falls back to a
 * standalone 🟢 ↔ ⚪ dot so the notification is still visible.
 *
 * - `setBaseTitle()` updates the status dot + label; an active flash is preserved.
 * - `flashTitle()` starts the blink, until the user returns to the tab (and,
 *   optionally, no longer than `maxSeconds` — Mudlet's `alert(seconds)`).
 * - A flash is a no-op while the tab is already focused, matching Mudlet.
 */

/** Leading status glyph (e.g. '🟢'), or '' when the indicator is off. */
let statusDot = '';
let label = 'mudix';
let flashing = false;
let blinkOn = false;
let intervalId: number | null = null;
/** Epoch ms at which a time-bounded flash ends; 0 = flash until focus only. */
let deadline = 0;
let listenersBound = false;

function render(): void {
    if (typeof document === 'undefined') return;
    // While flashing, blink the status dot itself to ⚪ (or show a standalone dot
    // if the indicator is off). Same-width emoji frames keep the title from
    // shifting as it blinks.
    let dot: string;
    if (flashing) dot = blinkOn ? (statusDot || '🟢') : '⚪';
    else dot = statusDot;
    document.title = dot ? `${dot} ${label}` : label;
}

function stopFlash(): void {
    if (!flashing) return;
    flashing = false;
    blinkOn = false;
    deadline = 0;
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    unbindListeners();
    render();
}

function onVisibility(): void {
    if (document.visibilityState === 'visible') stopFlash();
}

function bindListeners(): void {
    if (listenersBound || typeof window === 'undefined') return;
    listenersBound = true;
    window.addEventListener('focus', stopFlash);
    document.addEventListener('visibilitychange', onVisibility);
}

function unbindListeners(): void {
    if (!listenersBound) return;
    listenersBound = false;
    window.removeEventListener('focus', stopFlash);
    document.removeEventListener('visibilitychange', onVisibility);
}

function tick(): void {
    if (deadline && Date.now() >= deadline) { stopFlash(); return; }
    blinkOn = !blinkOn;
    render();
}

/**
 * Set the steady-state title: a leading status `dot` (pass '' for none) and the
 * profile `text`. Any active flash keeps running on top of it.
 */
export function setBaseTitle(text: string, dot = ''): void {
    label = text;
    statusDot = dot;
    render();
}

/**
 * Flash the title until the user returns to the tab. If `maxSeconds` is given it
 * also caps the duration. No-op while the tab is focused. Calling again while a
 * flash is active just refreshes the deadline (the blink keeps its phase).
 */
export function flashTitle(maxSeconds?: number): void {
    if (typeof document === 'undefined' || document.hasFocus()) return;
    deadline = maxSeconds && maxSeconds > 0 ? Date.now() + maxSeconds * 1000 : 0;
    if (flashing) return;
    flashing = true;
    blinkOn = true;
    bindListeners();
    render();
    intervalId = window.setInterval(tick, 500);
}

/** Stop any active flash immediately. Does not change the base title. */
export function clearTitleFlash(): void {
    stopFlash();
}
