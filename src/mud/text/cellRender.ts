/**
 * Renders text onto the monospace grid. Pure-ASCII runs are emitted as plain
 * text (the font lays them out at exactly 1ch each); every other grapheme is
 * boxed into a fixed `Nch` inline-block cell so wide/combining/font-fallback
 * glyphs can't drift the column grid. See `wcwidth.ts` for the width tables.
 */

import { isPlainAscii, segmentCells, type DisplayCell } from "./wcwidth";

export const CELL_CLASS = "ocell";

/** A grapheme that must be boxed: wide, zero-width, or any non-ASCII glyph. */
function needsCell(cell: DisplayCell): boolean {
    return cell.width !== 1 || !isPlainAscii(cell.text);
}

/** Append `text` to a DOM node as plain-text runs interleaved with cell spans. */
export function appendCells(parent: Node, text: string): void {
    if (text.length === 0) return;
    if (isPlainAscii(text)) {
        parent.appendChild(document.createTextNode(text));
        return;
    }

    let run = "";
    const flushRun = () => {
        if (run) {
            parent.appendChild(document.createTextNode(run));
            run = "";
        }
    };

    for (const cell of segmentCells(text)) {
        if (!needsCell(cell)) {
            run += cell.text;
            continue;
        }
        flushRun();
        const span = document.createElement("span");
        span.className = CELL_CLASS;
        span.style.width = `${cell.width}ch`;
        span.textContent = cell.text;
        parent.appendChild(span);
    }
    flushRun();
}

/** String equivalent of {@link appendCells} for the `toHtml()` path. */
export function cellsToHtml(text: string, escape: (s: string) => string): string {
    if (text.length === 0) return "";
    if (isPlainAscii(text)) return escape(text);

    let html = "";
    let run = "";
    const flushRun = () => {
        if (run) {
            html += escape(run);
            run = "";
        }
    };

    for (const cell of segmentCells(text)) {
        if (!needsCell(cell)) {
            run += cell.text;
            continue;
        }
        flushRun();
        html += `<span class="${CELL_CLASS}" style="width:${cell.width}ch">${escape(cell.text)}</span>`;
    }
    flushRun();
    return html;
}
