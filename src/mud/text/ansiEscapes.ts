// Low-level scanner for ANSI / ECMA-48 escape sequences shared by the ANSI
// buffer parser (FormatState) and the MXP parser. A terminal must *consume*
// every control sequence it recognizes — even the ones it doesn't act on —
// rather than printing the raw bytes. Before this existed, both parsers only
// understood `ESC [ … m` (SGR) and leaked everything else (OSC hyperlinks,
// cursor moves, charset designations) onto the screen as literal text.

const ESC = "\x1b";
const BEL = "\x07";

/** CSI final bytes are 0x40–0x7E (`@`…`~`). */
export function isCsiFinal(c: string): boolean {
    const code = c.charCodeAt(0);
    return code >= 0x40 && code <= 0x7e;
}

export interface EscapeScan {
    /**
     * - `csi`    — `ESC [ <params> <final>` (SGR, cursor moves, erase, …)
     * - `osc`    — `ESC ] <payload> ST` (OSC 8 hyperlinks, window title, …)
     * - `string` — DCS/SOS/PM/APC (`ESC P/X/^/_ … ST`); opaque, always ignored
     * - `esc`    — a short `ESC <intermediates> <final>` escape (charset, RIS, …)
     * - `incomplete` — the sequence runs off the end of `text`
     */
    kind: "csi" | "osc" | "string" | "esc" | "incomplete";
    /** Index one past the end of the sequence (exclusive). For `incomplete`,
     *  equals `text.length`. */
    end: number;
    /** CSI only: the final byte. */
    finalByte?: string;
    /** CSI only: the parameter + intermediate bytes between `ESC [` and the final. */
    params?: string;
    /** OSC only: the payload between `ESC ]` and the ST terminator. */
    oscPayload?: string;
}

/**
 * Scan a single escape sequence beginning at `text[start]` (which must be ESC).
 * Classifies the sequence and reports where it ends so callers can act on the
 * ones they understand and skip the rest. When the sequence is cut off by the
 * end of input the result is `incomplete` — callers either drop it or hold it
 * for the next line.
 */
export function scanEscape(text: string, start: number): EscapeScan {
    const n = text.length;
    const next = text[start + 1];
    if (next === undefined) return { kind: "incomplete", end: n };

    // CSI — ESC [ <params/intermediates> <final 0x40-0x7E>
    if (next === "[") {
        let j = start + 2;
        while (j < n && !isCsiFinal(text[j])) j++;
        if (j >= n) return { kind: "incomplete", end: n };
        return { kind: "csi", end: j + 1, finalByte: text[j], params: text.slice(start + 2, j) };
    }

    // OSC — ESC ] <payload> (BEL | ST). ST is the two-byte `ESC \`.
    if (next === "]") {
        let j = start + 2;
        while (j < n) {
            const c = text[j];
            if (c === BEL) return { kind: "osc", end: j + 1, oscPayload: text.slice(start + 2, j) };
            if (c === ESC && text[j + 1] === "\\") {
                return { kind: "osc", end: j + 2, oscPayload: text.slice(start + 2, j) };
            }
            j++;
        }
        return { kind: "incomplete", end: n };
    }

    // DCS / SOS / PM / APC — opaque strings terminated by BEL or ST.
    if (next === "P" || next === "X" || next === "^" || next === "_") {
        let j = start + 2;
        while (j < n) {
            const c = text[j];
            if (c === BEL) return { kind: "string", end: j + 1 };
            if (c === ESC && text[j + 1] === "\\") return { kind: "string", end: j + 2 };
            j++;
        }
        return { kind: "incomplete", end: n };
    }

    // Short escape — ESC <intermediates 0x20-0x2F> <final 0x30-0x7E>.
    // Covers charset designation (ESC ( B), RIS (ESC c), keypad modes, etc.
    let j = start + 1;
    while (j < n && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j++;
    if (j >= n) return { kind: "incomplete", end: n };
    return { kind: "esc", end: j + 1 };
}
