/**
 * Mudlet's `controlCharacterHandling` glyph substitution, ported from
 * `TTextEdit::replaceControlCharacterWith_Picture` / `_OEMFont`
 * (Mudlet/src/TTextEdit.cpp). Pure display-time substitution — the raw bytes
 * received from the MUD are never altered, only what gets painted.
 */
import type { ControlCharacterMode } from './controlCharacterMode';

/** Mudlet's default `mTabStopwidth`. */
export const TAB_STOP_WIDTH = 8;

/** C0 control codes (0x00-0x1F) plus DEL (0x7F) map 1:1 onto the Unicode
 *  "Control Pictures" block (U+2400-U+241F, U+2421 for DEL). */
const PICTURE_GLYPHS: Readonly<Record<number, number>> = {
    0: 0x2400, 1: 0x2401, 2: 0x2402, 3: 0x2403, 4: 0x2404, 5: 0x2405, 6: 0x2406, 7: 0x2407,
    8: 0x2408, 9: 0x2409, 10: 0x240a, 11: 0x240b, 12: 0x240c, 13: 0x240d, 14: 0x240e, 15: 0x240f,
    16: 0x2410, 17: 0x2411, 18: 0x2412, 19: 0x2413, 20: 0x2414, 21: 0x2415, 22: 0x2416, 23: 0x2417,
    24: 0x2418, 25: 0x2419, 26: 0x241a, 27: 0x241b, 28: 0x241c, 29: 0x241d, 30: 0x241e, 31: 0x241f,
    127: 0x2421,
};

/** CP437-style decorative glyphs ("OEM Font"-like), mimicking a DOS text window. */
const OEM_GLYPHS: Readonly<Record<number, number>> = {
    0: 0x20 /* space */, 1: 0x263a, 2: 0x263b, 3: 0x2665, 4: 0x2666, 5: 0x2663, 6: 0x2660, 7: 0x2022,
    8: 0x25d8, 9: 0x25cb, 10: 0x25d9, 11: 0x2642, 12: 0x2640, 13: 0x266a, 14: 0x266b, 15: 0x263c,
    16: 0x25ba, 17: 0x25c4, 18: 0x2195, 19: 0x203c, 20: 0x00b6, 21: 0x00a7, 22: 0x25ac, 23: 0x21a8,
    24: 0x2191, 25: 0x2193, 26: 0x2192, 27: 0x2190, 28: 0x221f, 29: 0x2194, 30: 0x25b2, 31: 0x25bc,
    127: 0x2302,
};

function isControlCodePoint(cp: number): boolean {
    return cp < 0x20 || cp === 0x7f;
}

/** A control-character cell's rendered replacement. `width` may exceed 2 —
 *  only tabs in AsIs/Picture mode expand past that, to the next tab stop,
 *  like a real terminal. `box` mirrors cellRender's span-vs-inline-run split. */
export interface ControlCellOverride {
    text: string;
    width: number;
    box: boolean;
}

/**
 * Returns the display substitution for one grapheme at `column` under `mode`,
 * or `null` if `grapheme` isn't a control character (caller should fall back
 * to normal cell rendering).
 *
 * - **asis**: control chars render as Mudlet's default case does — invisible,
 *   unchanged (handled by the caller's normal zero-width path) — except tab,
 *   which expands to the next tab stop.
 * - **picture**: codes 0-31/127 map onto the Unicode Control Pictures block;
 *   tab still expands to a tab stop, with the picture glyph over the first cell.
 * - **oem**: codes 0-31/127 map onto CP437-style glyphs; tab does *not* get
 *   tab-stop spacing here (matches Mudlet — it's just a plain glyph, width 1).
 */
export function overrideControlCell(grapheme: string, column: number, mode: ControlCharacterMode): ControlCellOverride | null {
    if (grapheme.length === 0) return null;
    const cp = grapheme.codePointAt(0)!;
    if (!isControlCodePoint(cp) || String.fromCodePoint(cp) !== grapheme) return null;

    if (cp === 0x09 && mode !== 'oem') {
        const width = TAB_STOP_WIDTH - (column % TAB_STOP_WIDTH);
        if (mode === 'asis') return { text: ' '.repeat(width), width, box: false };
        return { text: String.fromCodePoint(PICTURE_GLYPHS[9]), width, box: true };
    }
    if (mode === 'asis') return null;

    const glyph = (mode === 'picture' ? PICTURE_GLYPHS : OEM_GLYPHS)[cp];
    return glyph === undefined ? null : { text: String.fromCodePoint(glyph), width: 1, box: true };
}
