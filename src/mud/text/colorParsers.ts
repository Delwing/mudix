import mudletColors from './mudletColors.json';
import type { FormatStateSnapshot, RgbColor } from './FormatState';

const MUDLET_COLORS = mudletColors as unknown as Record<string, [number, number, number]>;

export function namedColorToAnsi(name: string, bg = false): string {
    if (name === 'r' || name === 'reset') return '\x1b[0m';
    const c = MUDLET_COLORS[name];
    if (!c) return '';
    return `\x1b[${bg ? 48 : 38};2;${c[0]};${c[1]};${c[2]}m`;
}

/** Converts a named Mudlet color to a FormatStateSnapshot for buffer-level coloring. */
export function namedColorToState(name: string, bg = false): FormatStateSnapshot | null {
    if (name === 'r' || name === 'reset') return {};
    const c = MUDLET_COLORS[name];
    if (!c) return null;
    const color: RgbColor = { space: 'rgb', r: c[0], g: c[1], b: c[2] };
    return bg ? { background: color } : { foreground: color };
}

/** cecho: <color_name>text<r>  or  <b:color_name>text for background */
export function parseCecho(text: string): string {
    return text.replace(/<([^>]+)>/g, (_, tag: string) => {
        if (tag.startsWith('b:')) return namedColorToAnsi(tag.slice(2), true);
        return namedColorToAnsi(tag);
    }) + '\x1b[0m';
}

/** decho: <r,g,b>text  or  <:r,g,b>text for background, <r> to reset */
export function parseDecho(text: string): string {
    return text
        .replace(/<(:?)(\d+),(\d+),(\d+)>/g, (_, bg, r, g, b) =>
            `\x1b[${bg ? 48 : 38};2;${r};${g};${b}m`)
        .replace(/<r>/g, '\x1b[0m') + '\x1b[0m';
}

/** hecho: #RRGGBBtext  or  #:RRGGBBtext for background, #r to reset */
export function parseHecho(text: string): string {
    return text
        .replace(/#(:?)([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/g,
            (_, bg, rh, gh, bh) =>
                `\x1b[${bg ? 48 : 38};2;${parseInt(rh, 16)};${parseInt(gh, 16)};${parseInt(bh, 16)}m`)
        .replace(/#r/g, '\x1b[0m') + '\x1b[0m';
}
