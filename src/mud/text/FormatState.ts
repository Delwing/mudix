import { colorCodes } from "./colors";
import mudletColorsJson from "./mudletColors.json";
import { scanEscape } from "./ansiEscapes";

const ESC = "";

export interface FormatHyperlink {
    onClick?: (ev: MouseEvent) => void;
    onContextMenu?: (ev: MouseEvent) => void;
    onMouseEnter?: (ev: MouseEvent) => void;
    onMouseLeave?: (ev: MouseEvent) => void;
    title?: string;
}

export interface IndexedColor {
    space: "indexed";
    index: number;
}

export interface RgbColor {
    space: "rgb";
    r: number;
    g: number;
    b: number;
    a?: number;
}

export interface HexColor {
    space: "hex";
    color: string;
}

export type FormatColor = IndexedColor | RgbColor | HexColor

export type DimEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface DimEffect {
    startOpacity: number;
    endOpacity: number;
    duration: number;
    easing?: DimEasing;
}

export interface FormatStateSnapshot {
    foreground?: FormatColor;
    background?: FormatColor;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    inverse?: boolean;
    strikethrough?: boolean;
    overline?: boolean;
    slowBlink?: boolean;
    rapidBlink?: boolean;
    dim?: DimEffect;
    hyperlink?: FormatHyperlink;
    cssClass?: string;
}

export type TextRange = [start: number, end: number];

export interface BufferSegment {
    text: string;
    state?: FormatStateSnapshot;
}

function cloneColor(color?: FormatColor): FormatColor | undefined {
    if (!color) return undefined;
    if (color.space === "indexed") {
        return {space: "indexed", index: color.index};
    }
    if (color.space === "hex") {
        return {space: "hex", color: color.color};
    }
    return color.a !== undefined
        ? {space: "rgb", r: color.r, g: color.g, b: color.b, a: color.a}
        : {space: "rgb", r: color.r, g: color.g, b: color.b};
}

function hyperlinksEqual(a?: FormatHyperlink, b?: FormatHyperlink): boolean {
    return !a && !b;
}

function colorsEqual(a?: FormatColor, b?: FormatColor): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.space !== b.space) return false;
    if (a.space === "indexed" && b.space === "indexed") {
        return a.index === b.index;
    }
    if (a.space === "rgb" && b.space === "rgb") {
        return a.r === b.r && a.g === b.g && a.b === b.b && (a.a ?? 255) === (b.a ?? 255);
    }
    if (a.space === "hex" && b.space === "hex") {
        return a.color === b.color;
    }
    return false;
}

function hasVisualFormatting(state?: FormatStateSnapshot): boolean {
    if (!state) return false;
    return !!(
        state.foreground ||
        state.background ||
        state.bold ||
        state.italic ||
        state.underline ||
        state.inverse ||
        state.strikethrough ||
        state.overline ||
        state.slowBlink ||
        state.rapidBlink ||
        state.dim ||
        state.cssClass
    );
}

function dimEffectsEqual(a?: DimEffect, b?: DimEffect): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
        a.startOpacity === b.startOpacity &&
        a.endOpacity === b.endOpacity &&
        a.duration === b.duration &&
        (a.easing || 'ease-in-out') === (b.easing || 'ease-in-out')
    );
}

function isDefaultState(state?: FormatStateSnapshot): boolean {
    return !hasVisualFormatting(state) && (!state || !state.hyperlink);
}

function cloneState(state?: FormatStateSnapshot): FormatStateSnapshot | undefined {
    if (!state) return undefined;
    return {
        foreground: cloneColor(state.foreground),
        background: cloneColor(state.background),
        bold: state.bold,
        italic: state.italic,
        underline: state.underline,
        inverse: state.inverse,
        strikethrough: state.strikethrough,
        overline: state.overline,
        slowBlink: state.slowBlink,
        rapidBlink: state.rapidBlink,
        dim: state.dim ? {...state.dim} : undefined,
        hyperlink: state.hyperlink ? {...state.hyperlink} : undefined,
        cssClass: state.cssClass,
    };
}

function statesEqual(a?: FormatStateSnapshot, b?: FormatStateSnapshot): boolean {
    if (isDefaultState(a) && isDefaultState(b)) return true;
    if (!a || !b) return false;
    return (
        colorsEqual(a.foreground, b.foreground) &&
        colorsEqual(a.background, b.background) &&
        !!a.bold === !!b.bold &&
        !!a.italic === !!b.italic &&
        !!a.underline === !!b.underline &&
        !!a.inverse === !!b.inverse &&
        !!a.strikethrough === !!b.strikethrough &&
        !!a.overline === !!b.overline &&
        !!a.slowBlink === !!b.slowBlink &&
        !!a.rapidBlink === !!b.rapidBlink &&
        dimEffectsEqual(a.dim, b.dim) &&
        hyperlinksEqual(a.hyperlink, b.hyperlink) &&
        a.cssClass === b.cssClass
    );
}

export class FormatState {

    static DEFAULT = {}

    foreground?: FormatColor;
    background?: FormatColor;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    inverse?: boolean;
    strikethrough?: boolean;
    overline?: boolean;
    slowBlink?: boolean;
    rapidBlink?: boolean;
    dim?: DimEffect;
    hyperlink?: FormatHyperlink;

    constructor(initial?: FormatStateSnapshot) {
        if (initial) {
            this.applySnapshot(initial);
        }
    }

    private applySnapshot(snapshot: FormatStateSnapshot): void {
        this.foreground = cloneColor(snapshot.foreground);
        this.background = cloneColor(snapshot.background);
        this.bold = snapshot.bold ? true : undefined;
        this.italic = snapshot.italic ? true : undefined;
        this.underline = snapshot.underline ? true : undefined;
        this.inverse = snapshot.inverse ? true : undefined;
        this.strikethrough = snapshot.strikethrough ? true : undefined;
        this.overline = snapshot.overline ? true : undefined;
        this.slowBlink = snapshot.slowBlink ? true : undefined;
        this.rapidBlink = snapshot.rapidBlink ? true : undefined;
        this.dim = snapshot.dim ? {...snapshot.dim} : undefined;
        this.hyperlink = snapshot.hyperlink ? {...snapshot.hyperlink} : undefined;
    }

    reset(): void {
        this.foreground = undefined;
        this.background = undefined;
        this.bold = undefined;
        this.italic = undefined;
        this.underline = undefined;
        this.inverse = undefined;
        this.strikethrough = undefined;
        this.overline = undefined;
        this.slowBlink = undefined;
        this.rapidBlink = undefined;
        this.dim = undefined;
    }

    toSnapshot(): FormatStateSnapshot {
        return {
            foreground: cloneColor(this.foreground),
            background: cloneColor(this.background),
            bold: this.bold ? true : undefined,
            italic: this.italic ? true : undefined,
            underline: this.underline ? true : undefined,
            inverse: this.inverse ? true : undefined,
            strikethrough: this.strikethrough ? true : undefined,
            overline: this.overline ? true : undefined,
            slowBlink: this.slowBlink ? true : undefined,
            rapidBlink: this.rapidBlink ? true : undefined,
            dim: this.dim ? {...this.dim} : undefined,
            hyperlink: this.hyperlink ? {...this.hyperlink} : undefined,
        };
    }

    applySgr(params: number[]): void {
        if (params.length === 0) {
            this.reset();
            return;
        }
        for (let i = 0; i < params.length; i += 1) {
            const code = params[i];
            switch (code) {
                case 0:
                    this.reset();
                    break;
                case 1:
                    this.bold = true;
                    break;
                case 3:
                    this.italic = true;
                    break;
                case 4:
                    this.underline = true;
                    break;
                case 5:
                    this.slowBlink = true;
                    break;
                case 6:
                    this.rapidBlink = true;
                    break;
                case 7:
                    this.inverse = true;
                    break;
                case 9:
                    this.strikethrough = true;
                    break;
                case 53:
                    this.overline = true;
                    break;
                case 22:
                    this.bold = undefined;
                    break;
                case 23:
                    this.italic = undefined;
                    break;
                case 24:
                    this.underline = undefined;
                    break;
                case 25:
                    this.slowBlink = undefined;
                    this.rapidBlink = undefined;
                    break;
                case 27:
                    this.inverse = undefined;
                    break;
                case 29:
                    this.strikethrough = undefined;
                    break;
                case 55:
                    this.overline = undefined;
                    break;
                case 39:
                    this.foreground = undefined;
                    break;
                case 49:
                    this.background = undefined;
                    break;
                case 38:
                case 48: {
                    const isForeground = code === 38;
                    const mode = params[i + 1];
                    if (mode === 5 && typeof params[i + 2] === "number") {
                        const color: HexColor = {space: "hex", color: colorCodes.xterm[params[i + 2]]};
                        if (isForeground) {
                            this.foreground = color;
                        } else {
                            this.background = color;
                        }
                        i += 2;
                    } else if (
                        mode === 2 &&
                        typeof params[i + 2] === "number" &&
                        typeof params[i + 3] === "number" &&
                        typeof params[i + 4] === "number"
                    ) {
                        const color: RgbColor = {
                            space: "rgb",
                            r: params[i + 2],
                            g: params[i + 3],
                            b: params[i + 4],
                        };
                        if (isForeground) {
                            this.foreground = color;
                        } else {
                            this.background = color;
                        }
                        i += 4;
                    }
                    break;
                }
                default:
                    if (code >= 30 && code <= 37) {
                        // Bold persists across SGRs and brightens the 30–37 dark
                        // palette into 90–97. Polish MUDs (Arkadia, Avalon) draw
                        // map glyphs as `\e[1;30m+`/`\e[1m...\e[30m+` — both must
                        // resolve to bright black, not invisible #000000 on a
                        // black background.
                        const bright = this.bold || params.includes(1);
                        const palette = bright ? colorCodes.ansi.bright : colorCodes.ansi.dark;
                        this.foreground = {space: "hex", color: palette[code - 30]};
                    } else if (code >= 90 && code <= 97) {
                        this.foreground = {space: "hex", color: colorCodes.ansi.bright[code - 90]};
                    } else if (code >= 40 && code <= 47) {
                        this.background = {space: "hex", color: colorCodes.ansi.dark[code - 40]};
                    } else if (code >= 100 && code <= 107) {
                        this.background = {space: "hex", color: colorCodes.ansi.bright[code - 100]};
                    }
                    break;
            }
        }
    }

    setHyperlink(link?: FormatHyperlink): void {
        this.hyperlink = link ? {...link} : undefined;
    }
}

function parseSgrCodes(sequence: string): number[] {
    if (!sequence) return [0];
    return sequence
        .split(";")
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .map(part => Number.parseInt(part, 10))
        .map(num => (Number.isNaN(num) ? 0 : num));
}

function parseAnsiSegments(text: string, baseState?: FormatStateSnapshot): BufferSegment[] {
    const segments: BufferSegment[] = [];
    const state = new FormatState(baseState);
    let buffer = "";
    const flush = (): void => {
        if (!buffer) return;
        const snapshot = state.toSnapshot();
        const storedState = isDefaultState(snapshot) ? undefined : snapshot;
        segments.push({text: buffer, state: storedState});
        buffer = "";
    };
    for (let i = 0; i < text.length;) {
        const char = text[i];
        if (char === ESC) {
            const esc = scanEscape(text, i);
            // An escape cut off by end-of-line is dropped (the line is already
            // fully assembled by the time we parse it; a truncated tail is junk).
            if (esc.kind === "incomplete") break;
            if (esc.kind === "csi" && esc.finalByte === "m") {
                flush();
                state.applySgr(parseSgrCodes(esc.params ?? ""));
            }
            // Every other recognized sequence (OSC links, cursor moves, charset
            // designation, DCS strings, …) is consumed and ignored — never
            // rendered. OSC 8 hyperlinks aren't supported yet; for now they're
            // simply skipped rather than printed as literal text.
            i = esc.end;
            continue;
        }
        buffer += char;
        i += 1;
    }
    flush();
    return segments;
}

/**
 * Buffer of text aware of ANSI formatting codes and hyperlink metadata.
 */
export class AnsiAwareBuffer {
    private segments: BufferSegment[] = [];
    private _deleted = false;
    private _onRender?: (container: HTMLElement) => void;
    private _textCache: string | null = null;
    private _renderContainer: HTMLElement | null = null;

    constructor(initial?: string | BufferSegment[], state?: FormatStateSnapshot) {
        if (typeof initial === "string") {
            this.segments = parseAnsiSegments(initial, state);
            this.normalizeSegments();
        } else if (Array.isArray(initial)) {
            this.segments = initial.map(segment => ({
                text: segment.text,
                state: cloneState(segment.state),
            }));
            this.normalizeSegments();
        } else if (initial === undefined && state) {
            this.segments = [];
        }
    }

    get deleted(): boolean {
        return this._deleted;
    }

    markAsDeleted(): this {
        this._deleted = true;
        return this;
    }

    /** Per-line prompt flag. Mudlet's TBuffer tracks isPrompt on each line so
     *  the matching `isPrompt()` script primitive reflects the prompt status of
     *  whatever line the cursor is currently on (not just the last). Set by the
     *  trigger pipeline before triggers run; defaults to false. */
    isPrompt = false;

    /** Wall-clock time (epoch ms) the line was created. Mudlet stamps every
     *  buffer line with a QTime; `getTimestamp(lineNumber)` reads it back. A
     *  buffer is built right as its line is echoed/received, so construction
     *  time is the line's timestamp. */
    timestamp = Date.now();

    removeFromDom(): void {
        const container = this._renderContainer;
        if (!container) return;
        container.parentElement?.removeChild(container);
        this._renderContainer = null;
    }

    onRender(callback: (container: HTMLElement) => void): this {
        this._onRender = callback;
        return this;
    }

    /** @internal */
    notifyRender(container: HTMLElement): void {
        this._renderContainer = container;
        if (this._onRender) {
            this._onRender(container);
            this._onRender = undefined;
        }
    }

    /** Re-renders the buffer into its previously notified container. No-op if not yet rendered. */
    rerender(): void {
        const container = this._renderContainer;
        if (!container) return;
        while (container.firstChild) container.removeChild(container.firstChild);
        if (this.length === 0) {
            container.innerHTML = '&nbsp;';
        } else {
            container.appendChild(this.toDom());
        }
    }

    /** Removes all formatting from a range (clears colors, bold, etc.). */
    clearFormat(range: TextRange): this {
        const [start, end] = range;
        if (start >= end) return this;
        const text = this.text.slice(start, end);
        this.replace([start, end], text, {});
        return this;
    }

    clone(): AnsiAwareBuffer {
        return new AnsiAwareBuffer(this.getSegments());
    }

    get text(): string {
        if (this._textCache === null) {
            this._textCache = this.segments.map(segment => segment.text).join("");
        }
        return this._textCache;
    }

    get length(): number {
        return this.segments.reduce((sum, segment) => sum + segment.text.length, 0);
    }

    clear(): this {
        this.segments = [];
        this._textCache = null;
        return this;
    }

    replace(range: [number, number], text: string, state?: FormatStateSnapshot): this {
        const [start, end] = range;
        this.assertRange(start, end);
        const fallback = state ? undefined : this.inferState(start);
        this.remove(range);
        if (text.length === 0) return this;
        this.insertInternal(start, text, state, fallback);
        return this;
    }

    replaceBuffer(range: [number, number], buffer: AnsiAwareBuffer): this {
        const [start, end] = range;
        this.assertRange(start, end);
        this.remove(range);
        if (buffer.length === 0) return this;
        this.insertBuffer(start, buffer);
        return this;
    }

    insert(index: number, text: string, state?: FormatStateSnapshot): this {
        if (text.length === 0) return this;
        this.assertIndex(index, true);
        const inferredState = state ? undefined : this.inferState(index);
        this.insertInternal(index, text, state, inferredState);
        return this;
    }

    insertBuffer(index: number, buffer: AnsiAwareBuffer): this {
        if (buffer.length === 0) return this;
        this.assertIndex(index, true);

        const sourceSegments = buffer.getSegments();
        if (sourceSegments.length === 0) return this;

        if (this.segments.length === 0) {
            this.segments = sourceSegments;
            this._textCache = null;
            return this;
        }

        if (index === this.length) {
            for (const segment of sourceSegments) {
                this.appendSegmentAtEnd(segment);
            }
            this.normalizeSegments();
            return this;
        }

        const position = this.resolveIndex(index, true);
        if (position.segmentIndex < this.segments.length) {
            this.splitSegment(position.segmentIndex, position.offset);
        }

        const insertionPoint = this.resolveBoundaryIndex(index);
        this.segments.splice(insertionPoint, 0, ...sourceSegments);
        this.normalizeSegments();
        return this;
    }

    prefix(text: string, state?: FormatStateSnapshot): this {
        this.insert(0, text, state ?? {});
        return this;
    }

    suffix(text: string, state?: FormatStateSnapshot): this {
        this.insert(this.length, text, state ?? {});
        return this;
    }

    private insertInternal(
        index: number,
        text: string,
        explicitState?: FormatStateSnapshot,
        baseState?: FormatStateSnapshot,
    ): void {
        if (text.length === 0) return;
        const insertionSegments = this.createSegmentsFromText(text, explicitState, baseState);
        if (insertionSegments.length === 0) return;
        if (this.segments.length === 0) {
            this.segments = insertionSegments.map(segment => ({
                text: segment.text,
                state: cloneState(segment.state),
            }));
            this._textCache = null;
            return;
        }
        if (index === this.length) {
            for (const segment of insertionSegments) {
                this.appendSegmentAtEnd(segment);
            }
            this.normalizeSegments();
            return;
        }
        const position = this.resolveIndex(index, true);
        if (position.segmentIndex < this.segments.length) {
            this.splitSegment(position.segmentIndex, position.offset);
        }
        const insertionPoint = this.resolveBoundaryIndex(index);
        this.segments.splice(insertionPoint, 0, ...insertionSegments.map(segment => ({
            text: segment.text,
            state: cloneState(segment.state),
        })));
        this.normalizeSegments();
    }

    append(text: string, state?: FormatStateSnapshot): this {
        this.insert(this.length, text, state);
        return this;
    }

    appendBuffer(buffer: AnsiAwareBuffer): this {
        this.insertBuffer(this.length, buffer);
        return this;
    }

    prepend(text: string, state?: FormatStateSnapshot): this {
        this.insert(0, text, state);
        return this;
    }

    prependBuffer(buffer: AnsiAwareBuffer): this {
        this.insertBuffer(0, buffer);
        return this;
    }

    remove(range: [number, number]): this {
        const [start, end] = range;
        this.assertRange(start, end);
        if (start === end) return this;
        const startPos = this.resolveIndex(start, true);
        if (startPos.segmentIndex < this.segments.length) {
            this.splitSegment(startPos.segmentIndex, startPos.offset);
        }
        const endPos = this.resolveIndex(end, true);
        if (endPos.segmentIndex < this.segments.length) {
            this.splitSegment(endPos.segmentIndex, endPos.offset);
        }
        const startIndex = this.resolveBoundaryIndex(start);
        const endIndex = this.resolveBoundaryIndex(end);
        this.segments.splice(startIndex, endIndex - startIndex);
        this.normalizeSegments();
        return this;
    }

    /** @internal */
    getSegments(): BufferSegment[] {
        return this.segments.map(segment => ({
            text: segment.text,
            state: cloneState(segment.state),
        }));
    }

    toHyperlinkSegments(): { text: string; hyperlink?: FormatHyperlink }[] {
        const segments: { text: string; hyperlink?: FormatHyperlink }[] = [];
        for (const segment of this.segments) {
            const link = segment.state?.hyperlink ? {...segment.state.hyperlink} : undefined;
            const last = segments[segments.length - 1];
            if (last && hyperlinksEqual(last.hyperlink, link)) {
                last.text += segment.text;
            } else {
                segments.push({text: segment.text, hyperlink: link});
            }
        }
        return segments;
    }

    color(range: TextRange, color: number | FormatStateSnapshot): this {
        const style = this.prepareStyle(color);
        const [start, end] = range;
        if (start >= end) return this;
        const text = this.text.slice(start, end);
        this.replace([start, end], text, style);
        return this;
    }

    applyFormat(range: TextRange, format: FormatStateSnapshot): this {
        const [start, end] = range;
        if (start >= end) return this;

        const text = this.text.slice(start, end);
        const currentState = this.getStateAt(start);

        const mergedState: FormatStateSnapshot = {
            ...currentState,
            ...format,
            foreground: format.foreground !== undefined ? format.foreground : currentState?.foreground,
            background: format.background !== undefined ? format.background : currentState?.background,
        };

        this.replace([start, end], text, mergedState);
        return this;
    }

    /**
     * Overlays a hyperlink on every segment in `range`, preserving each
     * segment's existing colors/attributes. Pass `undefined` to clear any
     * hyperlinks in the range. Unlike `applyFormat` (which homogenizes
     * formatting across the range), this is segment-wise — used by Mudlet
     * `setLink` so coloured selections remain coloured after becoming clickable.
     */
    setHyperlink(range: TextRange, hyperlink?: FormatHyperlink): this {
        const [start, end] = range;
        if (start >= end) return this;
        this.assertRange(start, end);

        const startPos = this.resolveIndex(start, true);
        if (startPos.segmentIndex < this.segments.length) {
            this.splitSegment(startPos.segmentIndex, startPos.offset);
        }
        const endPos = this.resolveIndex(end, true);
        if (endPos.segmentIndex < this.segments.length) {
            this.splitSegment(endPos.segmentIndex, endPos.offset);
        }
        const startIndex = this.resolveBoundaryIndex(start);
        const endIndex = this.resolveBoundaryIndex(end);
        for (let i = startIndex; i < endIndex; i++) {
            const seg = this.segments[i];
            const base = cloneState(seg.state) ?? {};
            base.hyperlink = hyperlink ? {...hyperlink} : undefined;
            seg.state = base;
        }
        this.normalizeSegments();
        return this;
    }

    colorWords(
        words: string | string[],
        color: number | FormatStateSnapshot,
        options: { caseInsensitive?: boolean } = {},
    ): this {
        const list = Array.isArray(words) ? words : [words];
        if (list.length === 0) return this;
        const caseInsensitive = options.caseInsensitive ?? false;
        const ranges: TextRange[] = [];
        const text = this.text;
        const haystack = caseInsensitive ? text.toLowerCase() : text;
        for (const word of list) {
            if (!word) continue;
            const needle = caseInsensitive ? word.toLowerCase() : word;
            let searchStart = 0;
            while (searchStart <= text.length - word.length) {
                const index = haystack.indexOf(needle, searchStart);
                if (index === -1) break;
                ranges.push([index, index + word.length]);
                searchStart = index + word.length;
            }
        }
        if (ranges.length === 0) return this;
        ranges.forEach(range => this.color(range, color));
        return this
    }

    splitLines(): AnsiAwareBuffer[] {
        const lines: AnsiAwareBuffer[] = [];
        let currentLineSegments: BufferSegment[] = [];

        for (const segment of this.segments) {
            const text = segment.text;
            let lastIndex = 0;

            for (let i = 0; i < text.length; i++) {
                if (text[i] === "\n") {
                    if (i > lastIndex) {
                        currentLineSegments.push({
                            text: text.slice(lastIndex, i),
                            state: cloneState(segment.state),
                        });
                    }

                    lines.push(new AnsiAwareBuffer(currentLineSegments));
                    currentLineSegments = [];
                    lastIndex = i + 1;
                }
            }

            if (lastIndex < text.length) {
                currentLineSegments.push({
                    text: text.slice(lastIndex),
                    state: cloneState(segment.state),
                });
            }
        }

        if (currentLineSegments.length > 0) {
            lines.push(new AnsiAwareBuffer(currentLineSegments));
        }

        if (lines.length === 0) {
            lines.push(new AnsiAwareBuffer());
        }

        return lines;
    }

    /** Returns the format state at the end of this buffer, for carrying into the next line. */
    trailingState(): FormatStateSnapshot | undefined {
        if (this.segments.length === 0) return undefined;
        return cloneState(this.segments[this.segments.length - 1].state);
    }

    toHtml(): string {
        let html = "";

        for (const segment of this.segments) {
            const escapedText = this.escapeHtml(segment.text);

            if (!segment.state || isDefaultState(segment.state)) {
                html += escapedText;
                continue;
            }

            const styles: string[] = [];
            const state = segment.state;

            const fg = state.inverse ? state.background : state.foreground;
            const bg = state.inverse ? state.foreground : state.background;

            if (fg) styles.push(`color: ${this.colorToHex(fg)}`);
            if (bg) styles.push(`background-color: ${this.colorToHex(bg)}`);
            if (state.bold) styles.push("font-weight: bold");
            if (state.italic) styles.push("font-style: italic");

            const decorations: string[] = [];
            if (state.underline) decorations.push("underline");
            if (state.strikethrough) decorations.push("line-through");
            if (state.overline) decorations.push("overline");
            if (decorations.length > 0) styles.push(`text-decoration: ${decorations.join(" ")}`);

            if (state.hyperlink) {
                styles.push("cursor: pointer");
                const dataAttr = ' data-output-clickable="true"';
                if (state.hyperlink.title) {
                    const titleAttr = ` title="${this.escapeHtml(state.hyperlink.title)}"`;
                    const styleAttr = styles.length > 0 ? ` style="${styles.join("; ")}"` : "";
                    html += `<span${styleAttr}${titleAttr}${dataAttr}>${escapedText}</span>`;
                    continue;
                }
                const styleAttr = styles.length > 0 ? ` style="${styles.join("; ")}"` : "";
                html += `<span${styleAttr}${dataAttr}>${escapedText}</span>`;
                continue;
            }

            const styleAttr = styles.length > 0 ? ` style="${styles.join("; ")}"` : "";
            html += `<span${styleAttr}>${escapedText}</span>`;
        }

        return html;
    }

    toDom(): DocumentFragment {
        const fragment = document.createDocumentFragment();

        for (const segment of this.segments) {
            const state = segment.state;

            if (!state || isDefaultState(state)) {
                fragment.appendChild(document.createTextNode(segment.text));
                continue;
            }

            const element = document.createElement('span');
            element.textContent = segment.text;

            const styles: string[] = [];

            const fg = state.inverse ? state.background : state.foreground;
            const bg = state.inverse ? state.foreground : state.background;

            if (fg) styles.push(`color: ${this.colorToHex(fg)}`);
            if (bg) styles.push(`background-color: ${this.colorToHex(bg)}`);
            if (state.bold) styles.push("font-weight: bold");
            if (state.italic) styles.push("font-style: italic");

            const decorations: string[] = [];
            if (state.underline) decorations.push("underline");
            if (state.strikethrough) decorations.push("line-through");
            if (state.overline) decorations.push("overline");
            if (decorations.length > 0) styles.push(`text-decoration: ${decorations.join(" ")}`);

            if (state.hyperlink) {
                styles.push("cursor: pointer");

                element.dataset.outputClickable = "true";

                if (state.hyperlink.title) {
                    element.title = state.hyperlink.title;
                }

                if (state.hyperlink.onClick) {
                    element.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        state.hyperlink!.onClick!(e);
                    });
                }

                if (state.hyperlink.onContextMenu) {
                    element.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        state.hyperlink!.onContextMenu!(e);
                    });
                }

                if (state.hyperlink.onMouseEnter) {
                    element.addEventListener('mouseenter', (e) => {
                        state.hyperlink!.onMouseEnter!(e);
                    });
                }

                if (state.hyperlink.onMouseLeave) {
                    element.addEventListener('mouseleave', (e) => {
                        state.hyperlink!.onMouseLeave!(e);
                    });
                }
            }

            if (state.dim) {
                styles.push(`--dim-start: ${state.dim.startOpacity}`);
                styles.push(`--dim-end: ${state.dim.endOpacity}`);
                styles.push(`--dim-duration: ${state.dim.duration}ms`);
                styles.push(`--dim-easing: ${state.dim.easing || 'ease-in-out'}`);
            }

            if (styles.length > 0) {
                element.style.cssText = styles.join("; ");
            }

            const classes: string[] = [];
            if (state.cssClass) classes.push(state.cssClass);
            if (state.slowBlink) classes.push('ansi-slow-blink');
            if (state.rapidBlink) classes.push('ansi-rapid-blink');
            if (state.dim) classes.push('ansi-dim');
            if (classes.length > 0) {
                element.className = classes.join(' ');
            }

            fragment.appendChild(element);
        }

        return fragment;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private colorToHex(color: FormatColor): string {
        if (color.space === "hex") {
            return color.color;
        }
        if (color.space === "rgb") {
            if (color.a !== undefined && color.a < 255) {
                return `rgba(${color.r}, ${color.g}, ${color.b}, ${(color.a / 255).toFixed(3)})`;
            }
            const r = color.r.toString(16).padStart(2, "0");
            const g = color.g.toString(16).padStart(2, "0");
            const b = color.b.toString(16).padStart(2, "0");
            return `#${r}${g}${b}`;
        }
        if (color.space === "indexed") {
            return colorCodes.xterm[color.index] || "#000000";
        }
        return "#000000";
    }

    private prepareStyle(styleOrIndex: number | FormatStateSnapshot): FormatStateSnapshot {
        if (typeof styleOrIndex === "number") {
            return {
                foreground: {
                    space: "indexed",
                    index: styleOrIndex,
                },
            };
        }
        return {...styleOrIndex};
    }

    private appendSegmentAtEnd(segment: BufferSegment): void {
        const last = this.segments[this.segments.length - 1];
        if (last && statesEqual(last.state, segment.state)) {
            last.text += segment.text;
        } else {
            this.segments.push({text: segment.text, state: cloneState(segment.state)});
        }
    }

    private createSegmentsFromText(
        text: string,
        explicitState?: FormatStateSnapshot,
        baseState?: FormatStateSnapshot,
    ): BufferSegment[] {
        if (!text) return [];
        if (explicitState) {
            if (text.length === 0) return [];
            return [{text, state: isDefaultState(explicitState) ? undefined : cloneState(explicitState)}];
        }
        if (!text.includes(ESC)) {
            const state = baseState && !isDefaultState(baseState) ? cloneState(baseState) : undefined;
            return [{text, state}];
        }
        return parseAnsiSegments(text, baseState);
    }

    private resolveIndex(index: number, allowEnd = false): { segmentIndex: number; offset: number } {
        this.assertIndex(index, allowEnd);
        let remaining = index;
        for (let i = 0; i < this.segments.length; i += 1) {
            const length = this.segments[i].text.length;
            if (remaining < length || (allowEnd && remaining === length)) {
                return {segmentIndex: i, offset: remaining};
            }
            remaining -= length;
        }
        return {segmentIndex: this.segments.length, offset: 0};
    }

    private resolveBoundaryIndex(index: number): number {
        const position = this.resolveIndex(index, true);
        const {segmentIndex, offset} = position;
        if (segmentIndex >= this.segments.length) {
            return this.segments.length;
        }
        if (offset <= 0) {
            return segmentIndex;
        }
        if (offset >= this.segments[segmentIndex].text.length) {
            return segmentIndex + 1;
        }
        return segmentIndex;
    }

    private inferState(index: number): FormatStateSnapshot | undefined {
        if (this.segments.length === 0) return undefined;
        if (index <= 0) return cloneState(this.segments[0].state);
        if (index >= this.length) return cloneState(this.segments[this.segments.length - 1].state);
        const before = this.resolveIndex(index - 1, true);
        const segment = this.segments[before.segmentIndex];
        if (before.offset + 1 === segment.text.length) {
            const nextSegment = this.segments[before.segmentIndex + 1];
            if (nextSegment && nextSegment.state && !segment.state) {
                return cloneState(nextSegment.state);
            }
        }
        return cloneState(segment.state);
    }

    private splitSegment(index: number, offset: number): void {
        const segment = this.segments[index];
        if (!segment) return;
        if (offset <= 0 || offset >= segment.text.length) return;
        const before: BufferSegment = {text: segment.text.slice(0, offset), state: cloneState(segment.state)};
        const after: BufferSegment = {text: segment.text.slice(offset), state: cloneState(segment.state)};
        this.segments.splice(index, 1, before, after);
    }

    private normalizeSegments(): void {
        const normalized: BufferSegment[] = [];
        for (const segment of this.segments) {
            if (!segment.text) continue;
            const state = isDefaultState(segment.state) ? undefined : cloneState(segment.state);
            const last = normalized[normalized.length - 1];
            if (last && statesEqual(last.state, state)) {
                last.text += segment.text;
            } else {
                normalized.push({text: segment.text, state});
            }
        }
        this.segments = normalized;
        this._textCache = null;
    }

    private assertRange(start: number, end: number): void {
        if (start < 0 || end < start || end > this.length) {
            throw new RangeError(`Invalid range [${start}, ${end}) for buffer of length ${this.length}`);
        }
    }

    getStateAt(index: number): FormatStateSnapshot | undefined {
        this.assertIndex(index, false);

        if (this.segments.length === 0) return undefined;

        let currentPos = 0;
        for (const segment of this.segments) {
            const segmentEnd = currentPos + segment.text.length;
            if (index >= currentPos && index < segmentEnd) {
                return cloneState(segment.state);
            }
            currentPos = segmentEnd;
        }

        return undefined;
    }

    applyMudletColors(): this {
        const originalText = this.text;
        const tagPattern = /<([a-z_:]+)>/gi;

        const MUDLET_COLORS: Record<string, FormatColor> = {};
        for (const [name, rgb] of Object.entries(mudletColorsJson)) {
            if (Array.isArray(rgb) && rgb.length >= 3) {
                MUDLET_COLORS[name.toLowerCase()] = {
                    space: 'rgb',
                    r: rgb[0],
                    g: rgb[1],
                    b: rgb[2],
                } as RgbColor;
            }
        }

        interface TagInfo {
            index: number;
            tagLength: number;
            tagName: string;
        }

        interface ParsedTag {
            type: 'fg' | 'bg' | 'reset';
            color?: FormatColor;
        }

        const parseMudletTag = (tagName: string): ParsedTag | null => {
            if (tagName === 'reset') {
                return { type: 'reset' };
            }
            if (tagName.startsWith('bg:')) {
                const colorName = tagName.substring(3);
                const color = MUDLET_COLORS[colorName.toLowerCase()];
                return color ? { type: 'bg', color } : null;
            }
            const color = MUDLET_COLORS[tagName.toLowerCase()];
            return color ? { type: 'fg', color } : null;
        };

        const tags: TagInfo[] = [];
        let match: RegExpExecArray | null;

        tagPattern.lastIndex = 0;
        while ((match = tagPattern.exec(originalText)) !== null) {
            tags.push({
                index: match.index,
                tagLength: match[0].length,
                tagName: match[1].toLowerCase()
            });
        }

        if (tags.length === 0) return this;

        for (let i = tags.length - 1; i >= 0; i--) {
            const tag = tags[i];
            this.remove([tag.index, tag.index + tag.tagLength]);
        }

        let offset = 0;
        for (let i = 0; i < tags.length; i++) {
            const tag = tags[i];
            const adjustedIndex = tag.index - offset;
            offset += tag.tagLength;

            const stateAtPosition = adjustedIndex < this.length
                ? this.getStateAt(adjustedIndex)
                : undefined;

            if (tag.tagName === 'reset') {
                const nextIndex = i < tags.length - 1 ? tags[i + 1].index - offset : this.length;
                if (nextIndex > adjustedIndex && adjustedIndex < this.length) {
                    this.color([adjustedIndex, nextIndex], stateAtPosition || {});
                }
            } else {
                const parsed = parseMudletTag(tag.tagName);
                if (parsed && parsed.type !== 'reset' && adjustedIndex < this.length) {
                    const nextIndex = i < tags.length - 1 ? tags[i + 1].index - offset : this.length;
                    if (nextIndex > adjustedIndex) {
                        const newState: FormatStateSnapshot = {
                            ...(stateAtPosition || {}),
                            ...(parsed.type === 'fg' ? { foreground: parsed.color } : {}),
                            ...(parsed.type === 'bg' ? { background: parsed.color } : {})
                        };
                        this.color([adjustedIndex, nextIndex], newState);
                    }
                }
            }
        }

        return this;
    }

    createLink(
        range: TextRange,
        options: {
            onClick?: (ev: MouseEvent) => void;
            onContextMenu?: (ev: MouseEvent) => void;
            onMouseEnter?: (ev: MouseEvent) => void;
            onMouseLeave?: (ev: MouseEvent) => void;
            title?: string;
        }
    ): this {
        const [start, end] = range;
        if (start >= end) return this;

        const text = this.text.slice(start, end);

        const hyperlink: FormatHyperlink = {
            onClick: options.onClick,
            onContextMenu: options.onContextMenu,
            onMouseEnter: options.onMouseEnter,
            onMouseLeave: options.onMouseLeave,
            title: options.title,
        };

        const currentState = this.getStateAt(start) || {};
        const newState: FormatStateSnapshot = {
            ...currentState,
            hyperlink,
        };

        this.replace([start, end], text, newState);
        return this;
    }

    createLinksForText(
        text: string,
        options: {
            onClick?: (ev: MouseEvent) => void;
            onContextMenu?: (ev: MouseEvent) => void;
            onMouseEnter?: (ev: MouseEvent) => void;
            onMouseLeave?: (ev: MouseEvent) => void;
            title?: string;
        },
        searchOptions: { caseInsensitive?: boolean } = {}
    ): this {
        if (!text) return this;

        const caseInsensitive = searchOptions.caseInsensitive ?? false;
        const ranges: TextRange[] = [];
        const bufferText = this.text;
        const haystack = caseInsensitive ? bufferText.toLowerCase() : bufferText;
        const needle = caseInsensitive ? text.toLowerCase() : text;

        let searchStart = 0;
        while (searchStart <= bufferText.length - text.length) {
            const index = haystack.indexOf(needle, searchStart);
            if (index === -1) break;
            ranges.push([index, index + text.length]);
            searchStart = index + text.length;
        }

        if (ranges.length === 0) return this;

        for (let i = ranges.length - 1; i >= 0; i--) {
            this.createLink(ranges[i], options);
        }

        return this;
    }

    private assertIndex(index: number, allowEnd: boolean): void {
        if (index < 0 || index > this.length || (!allowEnd && index >= this.length)) {
            throw new RangeError(`Index ${index} is out of bounds for buffer of length ${this.length}`);
        }
    }
}

export {cloneState as cloneFormatState, statesEqual as formatStatesEqual};

/**
 * Walks ANSI SGR escapes in `text` starting from `baseState` and returns the
 * SGR state that would apply *after* the last byte of `text`. Unlike
 * `AnsiAwareBuffer.trailingState()` (which returns the state of the last
 * non-empty text segment), this reflects the actual end-of-stream state:
 *   - empty `text` → returns `baseState`, so blank lines preserve carry
 *   - text ending in `\e[0m` → returns default (undefined), not the pre-reset color
 *   - text with no ANSI codes → returns `baseState` unchanged
 * Used to carry SGR state across line breaks the way Mudlet's TBuffer does.
 */
export function computeTrailingState(
    text: string,
    baseState?: FormatStateSnapshot,
): FormatStateSnapshot | undefined {
    const state = new FormatState(baseState);
    let i = 0;
    while (i < text.length) {
        if (text[i] === ESC) {
            const esc = scanEscape(text, i);
            if (esc.kind === "incomplete") break;
            if (esc.kind === "csi" && esc.finalByte === "m") {
                state.applySgr(parseSgrCodes(esc.params ?? ""));
            }
            // All other sequences are consumed without affecting carry state.
            i = esc.end;
            continue;
        }
        i += 1;
    }
    const snapshot = state.toSnapshot();
    return isDefaultState(snapshot) ? undefined : snapshot;
}
