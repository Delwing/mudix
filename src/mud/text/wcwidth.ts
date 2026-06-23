/**
 * Terminal display-width tables (a wcwidth-style implementation).
 *
 * MUD output is laid out on a monospace grid: every character occupies an
 * integer number of cells (0, 1, or 2). Browsers don't enforce that — a glyph
 * the chosen font lacks falls back to another font with a different advance
 * width, wide CJK/emoji render at their natural width, and combining marks add
 * code-unit length but no visual width. The renderer uses these tables to box
 * each grapheme into a fixed `Nch` cell so columns stay aligned regardless of
 * the font.
 *
 * Ranges follow Markus Kuhn's wcwidth (combining + East Asian Wide/Fullwidth),
 * extended with the Supplementary-plane emoji/symbol blocks. BMP dingbats and
 * miscellaneous symbols (☎ ★ ♠ …) are East Asian *Ambiguous* and kept at width
 * 1, matching the common "narrow" terminal rendering.
 */

type Interval = readonly [number, number];

/** Zero-width: combining marks, zero-width spaces, and format controls. */
const ZERO_WIDTH: readonly Interval[] = [
    [0x0300, 0x036f], // Combining Diacritical Marks
    [0x0483, 0x0489],
    [0x0591, 0x05bd],
    [0x05bf, 0x05bf],
    [0x05c1, 0x05c2],
    [0x05c4, 0x05c5],
    [0x05c7, 0x05c7],
    [0x0610, 0x061a],
    [0x064b, 0x065f],
    [0x0670, 0x0670],
    [0x06d6, 0x06dc],
    [0x06df, 0x06e4],
    [0x06e7, 0x06e8],
    [0x06ea, 0x06ed],
    [0x0711, 0x0711],
    [0x0730, 0x074a],
    [0x07a6, 0x07b0],
    [0x07eb, 0x07f3],
    [0x0816, 0x0819],
    [0x081b, 0x0823],
    [0x0825, 0x0827],
    [0x0829, 0x082d],
    [0x0859, 0x085b],
    [0x08e3, 0x0903],
    [0x093a, 0x093c],
    [0x093e, 0x094f],
    [0x0951, 0x0957],
    [0x0962, 0x0963],
    [0x0981, 0x0983],
    [0x09bc, 0x09bc],
    [0x09be, 0x09cd],
    [0x09d7, 0x09d7],
    [0x09e2, 0x09e3],
    [0x0a01, 0x0a03],
    [0x0a3c, 0x0a51],
    [0x0a70, 0x0a71],
    [0x0a75, 0x0a75],
    [0x0a81, 0x0a83],
    [0x0abc, 0x0acd],
    [0x0ae2, 0x0ae3],
    [0x0b01, 0x0b03],
    [0x0b3c, 0x0b57],
    [0x0b82, 0x0b82],
    [0x0bbe, 0x0bcd],
    [0x0bd7, 0x0bd7],
    [0x0c00, 0x0c03],
    [0x0c3e, 0x0c56],
    [0x0c81, 0x0c83],
    [0x0cbc, 0x0ccd],
    [0x0cd5, 0x0cd6],
    [0x0d01, 0x0d03],
    [0x0d3e, 0x0d4d],
    [0x0d57, 0x0d57],
    [0x0d82, 0x0d83],
    [0x0dca, 0x0ddf],
    [0x0e31, 0x0e31],
    [0x0e34, 0x0e3a],
    [0x0e47, 0x0e4e],
    [0x0eb1, 0x0eb1],
    [0x0eb4, 0x0ebc],
    [0x0ec8, 0x0ecd],
    [0x0f18, 0x0f19],
    [0x0f35, 0x0f35],
    [0x0f37, 0x0f37],
    [0x0f39, 0x0f39],
    [0x0f3e, 0x0f3f],
    [0x0f71, 0x0f84],
    [0x0f86, 0x0f87],
    [0x0f8d, 0x0fbc],
    [0x0fc6, 0x0fc6],
    [0x102b, 0x103e],
    [0x1056, 0x1059],
    [0x105e, 0x1060],
    [0x1062, 0x1064],
    [0x1067, 0x106d],
    [0x1071, 0x1074],
    [0x1082, 0x108d],
    [0x108f, 0x108f],
    [0x109a, 0x109d],
    [0x135d, 0x135f],
    [0x1712, 0x1714],
    [0x1732, 0x1734],
    [0x1752, 0x1753],
    [0x1772, 0x1773],
    [0x17b4, 0x17d3],
    [0x17dd, 0x17dd],
    [0x180b, 0x180d],
    [0x1885, 0x1886],
    [0x18a9, 0x18a9],
    [0x1920, 0x192b],
    [0x1930, 0x193b],
    [0x1a17, 0x1a1b],
    [0x1a55, 0x1a7f],
    [0x1ab0, 0x1aff],
    [0x1b00, 0x1b04],
    [0x1b34, 0x1b44],
    [0x1b6b, 0x1b73],
    [0x1b80, 0x1b82],
    [0x1ba1, 0x1bad],
    [0x1be6, 0x1bf3],
    [0x1c24, 0x1c37],
    [0x1cd0, 0x1cd2],
    [0x1cd4, 0x1ce8],
    [0x1ced, 0x1ced],
    [0x1cf2, 0x1cf4],
    [0x1cf8, 0x1cf9],
    [0x1dc0, 0x1dff],
    [0x200b, 0x200f], // zero-width space / joiners / directional marks
    [0x202a, 0x202e],
    [0x2060, 0x2064],
    [0x20d0, 0x20f0], // Combining Diacritical Marks for Symbols
    [0x2cef, 0x2cf1],
    [0x2d7f, 0x2d7f],
    [0x2de0, 0x2dff],
    [0x302a, 0x302f],
    [0x3099, 0x309a],
    [0xa66f, 0xa672],
    [0xa674, 0xa67d],
    [0xa69e, 0xa69f],
    [0xa6f0, 0xa6f1],
    [0xa802, 0xa802],
    [0xa806, 0xa806],
    [0xa80b, 0xa80b],
    [0xa823, 0xa827],
    [0xa880, 0xa881],
    [0xa8b4, 0xa8c5],
    [0xa8e0, 0xa8f1],
    [0xa926, 0xa92d],
    [0xa947, 0xa953],
    [0xa980, 0xa983],
    [0xa9b3, 0xa9c0],
    [0xaa29, 0xaa36],
    [0xaa43, 0xaa43],
    [0xaa4c, 0xaa4d],
    [0xaab0, 0xaab0],
    [0xaab2, 0xaab4],
    [0xaab7, 0xaab8],
    [0xaabe, 0xaabf],
    [0xaac1, 0xaac1],
    [0xaaeb, 0xaaef],
    [0xaaf5, 0xaaf6],
    [0xabe3, 0xabea],
    [0xabec, 0xabed],
    [0xfb1e, 0xfb1e],
    [0xfe00, 0xfe0f], // variation selectors
    [0xfe20, 0xfe2f], // Combining Half Marks
    [0xfeff, 0xfeff], // zero-width no-break space (BOM)
    [0xfff9, 0xfffb],
    [0x101fd, 0x101fd],
    [0x1d165, 0x1d169],
    [0x1d16d, 0x1d182],
    [0x1d185, 0x1d18b],
    [0x1d1aa, 0x1d1ad],
    [0x1d242, 0x1d244],
    [0xe0100, 0xe01ef], // variation selectors supplement
];

/** Wide (2-cell): East Asian Wide/Fullwidth and Supplementary-plane emoji. */
const WIDE: readonly Interval[] = [
    [0x1100, 0x115f], // Hangul Jamo
    [0x231a, 0x231b], // watch, hourglass (emoji)
    [0x2329, 0x232a],
    [0x23e9, 0x23ec],
    [0x23f0, 0x23f0],
    [0x23f3, 0x23f3],
    [0x25fd, 0x25fe],
    [0x2614, 0x2615],
    [0x2648, 0x2653], // zodiac
    [0x267f, 0x267f],
    [0x2693, 0x2693],
    [0x26a1, 0x26a1],
    [0x26aa, 0x26ab],
    [0x26bd, 0x26be],
    [0x26c4, 0x26c5],
    [0x26ce, 0x26ce],
    [0x26d4, 0x26d4],
    [0x26ea, 0x26ea],
    [0x26f2, 0x26f3],
    [0x26f5, 0x26f5],
    [0x26fa, 0x26fa],
    [0x26fd, 0x26fd],
    [0x2705, 0x2705],
    [0x270a, 0x270b],
    [0x2728, 0x2728],
    [0x274c, 0x274c],
    [0x274e, 0x274e],
    [0x2753, 0x2755],
    [0x2757, 0x2757],
    [0x2795, 0x2797],
    [0x27b0, 0x27b0],
    [0x27bf, 0x27bf],
    [0x2b1b, 0x2b1c],
    [0x2b50, 0x2b50],
    [0x2b55, 0x2b55],
    [0x2e80, 0x303e], // CJK Radicals … CJK Symbols and Punctuation
    [0x3041, 0x33ff], // Hiragana … CJK Compatibility
    [0x3400, 0x4dbf], // CJK Extension A
    [0x4e00, 0x9fff], // CJK Unified Ideographs
    [0xa000, 0xa4cf], // Yi
    [0xa960, 0xa97f], // Hangul Jamo Extended-A
    [0xac00, 0xd7a3], // Hangul Syllables
    [0xf900, 0xfaff], // CJK Compatibility Ideographs
    [0xfe10, 0xfe19], // Vertical Forms
    [0xfe30, 0xfe6f], // CJK Compatibility / Small Forms
    [0xff00, 0xff60], // Fullwidth Forms
    [0xffe0, 0xffe6], // Fullwidth signs
    [0x16fe0, 0x16fe4],
    [0x17000, 0x18d08], // Tangut etc.
    [0x1aff0, 0x1b16f], // Kana
    [0x1f004, 0x1f004], // mahjong red dragon
    [0x1f0cf, 0x1f0cf], // playing card black joker
    [0x1f18e, 0x1f18e],
    [0x1f191, 0x1f19a],
    [0x1f200, 0x1f320],
    [0x1f32d, 0x1f335],
    [0x1f337, 0x1f37c],
    [0x1f37e, 0x1f393],
    [0x1f3a0, 0x1f3ca],
    [0x1f3cf, 0x1f3d3],
    [0x1f3e0, 0x1f3f0],
    [0x1f3f4, 0x1f3f4],
    [0x1f3f8, 0x1f43e],
    [0x1f440, 0x1f440],
    [0x1f442, 0x1f4fc],
    [0x1f4ff, 0x1f53d],
    [0x1f54b, 0x1f54e],
    [0x1f550, 0x1f567],
    [0x1f57a, 0x1f57a],
    [0x1f595, 0x1f596],
    [0x1f5a4, 0x1f5a4],
    [0x1f5fb, 0x1f64f], // emoticons
    [0x1f680, 0x1f6c5], // transport
    [0x1f6cc, 0x1f6cc],
    [0x1f6d0, 0x1f6d2],
    [0x1f6d5, 0x1f6d7],
    [0x1f6dd, 0x1f6df],
    [0x1f6eb, 0x1f6ec],
    [0x1f6f4, 0x1f6fc],
    [0x1f7e0, 0x1f7eb],
    [0x1f7f0, 0x1f7f0],
    [0x1f90c, 0x1f93a],
    [0x1f93c, 0x1f945],
    [0x1f947, 0x1f9ff], // supplemental symbols
    [0x1fa70, 0x1faff],
    [0x20000, 0x2fffd], // CJK Extension B+
    [0x30000, 0x3fffd], // CJK Extension G+
];

function inRanges(cp: number, ranges: readonly Interval[]): boolean {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const [start, end] = ranges[mid];
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return true;
    }
    return false;
}

/**
 * Display width of a single Unicode code point, in monospace cells.
 * Returns 0 for combining/zero-width, 2 for wide, 1 otherwise. C0/C1 control
 * characters (which shouldn't reach the renderer) are treated as 0.
 */
export function codePointWidth(cp: number): 0 | 1 | 2 {
    if (cp === 0) return 0;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0; // control characters
    if (inRanges(cp, ZERO_WIDTH)) return 0;
    if (inRanges(cp, WIDE)) return 2;
    return 1;
}

/**
 * Display width of a grapheme cluster (base + any combining marks / ZWJ
 * sequence). Width is the widest code point in the cluster, so an emoji ZWJ
 * sequence stays 2 and a base+diacritic stays at the base's width.
 */
export function clusterWidth(cluster: string): 0 | 1 | 2 {
    let width: 0 | 1 | 2 = 0;
    for (const ch of cluster) {
        const w = codePointWidth(ch.codePointAt(0)!);
        if (w > width) width = w;
        if (width === 2) break;
    }
    return width;
}

/** Total display width of a string, in monospace cells. */
export function stringWidth(text: string): number {
    let width = 0;
    for (const cell of segmentCells(text)) {
        width += cell.width;
    }
    return width;
}

export interface DisplayCell {
    /** The grapheme cluster occupying this cell. */
    text: string;
    /** Number of monospace cells the grapheme occupies (0, 1, or 2). */
    width: 0 | 1 | 2;
}

const segmenter: Intl.Segmenter | undefined =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : undefined;

/**
 * Split text into display cells, one per grapheme cluster. Uses
 * `Intl.Segmenter` for proper cluster boundaries (so combining marks fold into
 * their base), falling back to per-code-point iteration where it is missing.
 */
export function segmentCells(text: string): DisplayCell[] {
    const cells: DisplayCell[] = [];
    if (segmenter) {
        for (const { segment } of segmenter.segment(text)) {
            cells.push({ text: segment, width: clusterWidth(segment) });
        }
    } else {
        for (const ch of text) {
            cells.push({ text: ch, width: codePointWidth(ch.codePointAt(0)!) });
        }
    }
    return cells;
}

/** Fast check: pure printable ASCII renders at exactly 1 cell with no boxing. */
export function isPlainAscii(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 0x20 || c > 0x7e) return false;
    }
    return true;
}
