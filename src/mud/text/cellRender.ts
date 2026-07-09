/**
 * Renders text onto the monospace grid. Pure-ASCII runs are emitted as plain
 * text (the font lays them out at exactly 1ch each); every other grapheme is
 * boxed into a fixed `Nch` inline-block cell so wide/combining/font-fallback
 * glyphs can't drift the column grid. See `wcwidth.ts` for the width tables.
 */

import { isPlainAscii, segmentCells, type DisplayCell } from "./wcwidth";
import { overrideControlCell } from "./controlChars";
import { getControlCharacterMode, type ControlCharacterMode } from "./controlCharacterMode";

export const CELL_CLASS = "ocell";

/** A grapheme that must be boxed: wide, zero-width, or any non-ASCII glyph. */
function needsCell(cell: DisplayCell): boolean {
    return cell.width !== 1 || !isPlainAscii(cell.text);
}

/** Resolve one grapheme to its rendered form, applying `controlCharacterHandling`
 *  substitution (tab-stop expansion / Mudlet Picture/OEM glyphs) first. */
function resolveCell(cell: DisplayCell, column: number, mode: ControlCharacterMode): { text: string; width: number; box: boolean } {
    return overrideControlCell(cell.text, column, mode) ?? { text: cell.text, width: cell.width, box: needsCell(cell) };
}

/** Append `text` to a DOM node as plain-text runs interleaved with cell spans,
 *  starting at column `column` (for tab-stop math). Returns the column after
 *  `text` — pass it into the next segment's call to keep tab stops correct
 *  across a whole logical line. */
export function appendCells(parent: Node, text: string, column = 0, mode: ControlCharacterMode = getControlCharacterMode()): number {
    if (text.length === 0) return column;
    if (isPlainAscii(text)) {
        parent.appendChild(document.createTextNode(text));
        return column + text.length;
    }

    let run = "";
    let col = column;
    const flushRun = () => {
        if (run) {
            parent.appendChild(document.createTextNode(run));
            run = "";
        }
    };

    for (const cell of segmentCells(text)) {
        const rc = resolveCell(cell, col, mode);
        col += rc.width;
        if (!rc.box) {
            run += rc.text;
            continue;
        }
        flushRun();
        const span = document.createElement("span");
        span.className = CELL_CLASS;
        span.style.width = `${rc.width}ch`;
        span.textContent = rc.text;
        parent.appendChild(span);
    }
    flushRun();
    return col;
}

/** String equivalent of {@link appendCells} for the `toHtml()` path. Unlike
 *  `appendCells`, this keeps returning a plain string — use {@link columnAfter}
 *  to carry the running column across segments. */
export function cellsToHtml(text: string, escape: (s: string) => string, column = 0, mode: ControlCharacterMode = getControlCharacterMode()): string {
    if (text.length === 0) return "";
    if (isPlainAscii(text)) return escape(text);

    let html = "";
    let run = "";
    let col = column;
    const flushRun = () => {
        if (run) {
            html += escape(run);
            run = "";
        }
    };

    for (const cell of segmentCells(text)) {
        const rc = resolveCell(cell, col, mode);
        col += rc.width;
        if (!rc.box) {
            run += rc.text;
            continue;
        }
        flushRun();
        html += `<span class="${CELL_CLASS}" style="width:${rc.width}ch">${escape(rc.text)}</span>`;
    }
    flushRun();
    return html;
}

/** Column after rendering `text` starting at `column` — mirrors `cellsToHtml`'s
 *  width math without building output, so `toHtml()` can advance its running
 *  column between segments while `cellsToHtml` keeps returning a plain string. */
export function columnAfter(text: string, column: number, mode: ControlCharacterMode = getControlCharacterMode()): number {
    if (text.length === 0) return column;
    if (isPlainAscii(text)) return column + text.length;

    let col = column;
    for (const cell of segmentCells(text)) {
        col += resolveCell(cell, col, mode).width;
    }
    return col;
}
