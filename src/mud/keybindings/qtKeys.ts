/**
 * Mudlet's `tempKey(...)` (and Qt-rooted Mudlet bindings in general) reference
 * keys by Qt::Key integer code. The browser KeyEngine matches against
 * `KeyboardEvent.code`, so Lua-supplied Qt codes need a translation step.
 *
 * Coverage focuses on keys scripts actually bind: arrows, function keys,
 * editing keys, navigation, modifiers, letters, digits, numpad, symbols.
 * Qt codes that have no DOM equivalent (Direction_*, screen-control keys,
 * dead keys) fall through and the matcher silently fails — same as Mudlet
 * on platforms where the key isn't reachable.
 *
 * Reference: https://doc.qt.io/qt-6/qt.html#Key-enum
 */
const QT_KEY_TO_DOM_CODE: Record<number, string> = {
    0x01000000: 'Escape',
    0x01000001: 'Tab',
    0x01000002: 'Tab',                // Backtab — DOM has no separate code
    0x01000003: 'Backspace',
    0x01000004: 'Enter',              // Qt::Key_Return → main Enter
    0x01000005: 'NumpadEnter',        // Qt::Key_Enter  → numpad Enter
    0x01000006: 'Insert',
    0x01000007: 'Delete',
    0x01000008: 'Pause',
    0x01000009: 'PrintScreen',
    0x0100000B: 'NumLock',            // Qt::Key_Clear maps to NumLock 5 on PC keyboards
    0x01000010: 'Home',
    0x01000011: 'End',
    0x01000012: 'ArrowLeft',
    0x01000013: 'ArrowUp',
    0x01000014: 'ArrowRight',
    0x01000015: 'ArrowDown',
    0x01000016: 'PageUp',
    0x01000017: 'PageDown',
    0x01000020: 'ShiftLeft',
    0x01000021: 'ControlLeft',
    0x01000022: 'MetaLeft',
    0x01000023: 'AltLeft',
    0x01000024: 'AltRight',           // Qt::Key_AltGr
    0x01000025: 'CapsLock',
    0x01000026: 'NumLock',
    0x01000027: 'ScrollLock',
    0x01000030: 'F1',
    0x01000031: 'F2',
    0x01000032: 'F3',
    0x01000033: 'F4',
    0x01000034: 'F5',
    0x01000035: 'F6',
    0x01000036: 'F7',
    0x01000037: 'F8',
    0x01000038: 'F9',
    0x01000039: 'F10',
    0x0100003A: 'F11',
    0x0100003B: 'F12',
    0x0100003C: 'F13',
    0x0100003D: 'F14',
    0x0100003E: 'F15',
    0x0100003F: 'F16',
    0x01000040: 'F17',
    0x01000041: 'F18',
    0x01000042: 'F19',
    0x01000043: 'F20',
    0x01000044: 'F21',
    0x01000045: 'F22',
    0x01000046: 'F23',
    0x01000047: 'F24',
    0x01000053: 'ContextMenu',        // Qt::Key_Menu

    // ASCII-range Qt codes coincide with character codes. 0–9 → DigitN,
    // A–Z → KeyN. Both are the values `event.code` reports for top-row
    // digits and the alpha row.
    0x20: 'Space',
    0x21: 'Digit1',                   // ! shares DOM code with 1
    0x22: 'Quote',                    // "
    0x23: 'Digit3',                   // #
    0x24: 'Digit4',                   // $
    0x25: 'Digit5',                   // %
    0x26: 'Digit7',                   // &
    0x27: 'Quote',                    // '
    0x28: 'Digit9',                   // (
    0x29: 'Digit0',                   // )
    0x2A: 'Digit8',                   // *
    0x2B: 'Equal',                    // +
    0x2C: 'Comma',                    // ,
    0x2D: 'Minus',                    // -
    0x2E: 'Period',                   // .
    0x2F: 'Slash',                    // /
    0x3A: 'Semicolon',                // :
    0x3B: 'Semicolon',                // ;
    0x3C: 'Comma',                    // <
    0x3D: 'Equal',                    // =
    0x3E: 'Period',                   // >
    0x3F: 'Slash',                    // ?
    0x40: 'Digit2',                   // @
    0x5B: 'BracketLeft',              // [
    0x5C: 'Backslash',
    0x5D: 'BracketRight',
    0x5E: 'Digit6',                   // ^
    0x5F: 'Minus',                    // _
    0x60: 'Backquote',
    0x7B: 'BracketLeft',              // {
    0x7C: 'Backslash',                // |
    0x7D: 'BracketRight',             // }
    0x7E: 'Backquote',                // ~
};

/**
 * Translate a Qt::Key integer (or already-translated DOM `KeyboardEvent.code`
 * string) into a DOM `KeyboardEvent.code`. Mudlet `tempKey` accepts both;
 * passing a string straight through lets users pre-resolve when they prefer.
 */
export function qtKeyToDomCode(key: string | number): string {
    if (typeof key === 'string') return key;
    if (!Number.isFinite(key)) return String(key);

    // Digit row: Qt::Key_0..Key_9 == 0x30..0x39
    if (key >= 0x30 && key <= 0x39) return 'Digit' + String.fromCharCode(key);
    // Alpha row: Qt::Key_A..Key_Z == 0x41..0x5A
    if (key >= 0x41 && key <= 0x5A) return 'Key' + String.fromCharCode(key);

    return QT_KEY_TO_DOM_CODE[key] ?? String(key);
}

/**
 * Translate a Qt::KeyboardModifier bitmask into an array of modifier names
 * that match the {ctrl,shift,alt,meta} strings KeyEngine compares against.
 *
 * Qt::ShiftModifier   = 0x02000000
 * Qt::ControlModifier = 0x04000000
 * Qt::AltModifier     = 0x08000000
 * Qt::MetaModifier    = 0x10000000
 * Qt::KeypadModifier  = 0x20000000  (ignored — DOM `code` already encodes "Numpad*")
 * Qt::GroupSwitchMod. = 0x40000000  (ignored — X11-only)
 */
export function qtModifiersToList(modifier: number): string[] {
    const mods: string[] = [];
    if (modifier & 0x04000000) mods.push('ctrl');
    if (modifier & 0x02000000) mods.push('shift');
    if (modifier & 0x08000000) mods.push('alt');
    if (modifier & 0x10000000) mods.push('meta');
    return mods;
}
