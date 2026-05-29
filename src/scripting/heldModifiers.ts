// Tracks which keyboard modifiers are currently held, for Mudlet's
// `holdingModifiers(number)`. Mudlet reads the live Qt keyboard-modifier state
// (QGuiApplication::queryKeyboardModifiers) at call time; the browser has no
// equivalent global poll, so we keep the state fresh by snapshotting the
// modifier flags off every keyboard/pointer event (each one carries
// shiftKey/ctrlKey/altKey/metaKey). Because holdingModifiers is almost always
// called in direct response to a user action, the snapshot reflects the event
// that triggered it.
//
// The returned bitmask uses the same values as `mudlet.keymodifier`
// (KeyCodes.lua) — the real Qt::KeyboardModifier flags — so a script can call
// `holdingModifiers(mudlet.keymodifier.Control)` and get an exact-equality
// comparison, matching Mudlet's semantics.

const QT_SHIFT = 0x02000000;
const QT_CONTROL = 0x04000000;
const QT_ALT = 0x08000000;
const QT_META = 0x10000000;

let held = 0;
let installed = false;

function snapshot(e: KeyboardEvent | MouseEvent): void {
    held =
        (e.shiftKey ? QT_SHIFT : 0) |
        (e.ctrlKey ? QT_CONTROL : 0) |
        (e.altKey ? QT_ALT : 0) |
        (e.metaKey ? QT_META : 0);
}

function ensureInstalled(): void {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('keydown', snapshot, opts);
    document.addEventListener('keyup', snapshot, opts);
    document.addEventListener('mousedown', snapshot, opts);
    document.addEventListener('mouseup', snapshot, opts);
    document.addEventListener('mousemove', snapshot, opts);
    // Window focus loss can leave a modifier "stuck" (we never see its keyup);
    // clear on blur so a later poll doesn't report a phantom modifier.
    window.addEventListener('blur', () => { held = 0; });
}

/** Current held-modifier bitmask in Qt::KeyboardModifier units (matches
 *  `mudlet.keymodifier`). Installs the global listeners on first call. */
export function getHeldModifiers(): number {
    ensureInstalled();
    return held;
}
