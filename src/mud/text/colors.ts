import xterm256 from "./xterm256";

const DEFAULT_ANSI_DARK = ["#000000", "#bb0000", "#00bb00", "#bbbb00", "#0000bb", "#bb00bb", "#00bbbb", "#bbbbbb"];
const DEFAULT_ANSI_BRIGHT = ["#555555", "#ff5555", "#55ff55", "#ffff55", "#5555ff", "#ff55ff", "#55ffff", "#ffffff"];

export const colorCodes = {
    xterm: xterm256 as string[],
    ansi: {
        bright: [...DEFAULT_ANSI_BRIGHT],
        dark:   [...DEFAULT_ANSI_DARK],
    },
};

/** Built-in 16-color ANSI palette. Index 0–7 dark, 8–15 bright. The Settings
 *  modal uses this as the fallback when a profile hasn't overridden a slot. */
export const DEFAULT_ANSI_PALETTE: readonly string[] = [...DEFAULT_ANSI_DARK, ...DEFAULT_ANSI_BRIGHT];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Apply an override palette to the global ANSI table (mutates colorCodes.ansi
 *  in place so FormatState picks it up without plumbing). Pass `undefined` or
 *  a sparse array to restore defaults for unspecified / invalid slots. The
 *  palette layout is `[...dark(8), ...bright(8)]`. */
export function applyAnsiPalette(palette?: readonly (string | undefined)[]): void {
    for (let i = 0; i < 8; i++) {
        const v = palette?.[i];
        colorCodes.ansi.dark[i] = (typeof v === 'string' && HEX_RE.test(v)) ? v : DEFAULT_ANSI_DARK[i];
    }
    for (let i = 0; i < 8; i++) {
        const v = palette?.[i + 8];
        colorCodes.ansi.bright[i] = (typeof v === 'string' && HEX_RE.test(v)) ? v : DEFAULT_ANSI_BRIGHT[i];
    }
}
