import { FormatState } from './FormatState';
import { AnsiAwareBuffer } from './FormatState';

/**
 * Self-contained text output entity — equivalent of Mudlet's TConsole.
 * Owns format state, line history, and cursor position.
 * The renderer is a pure consumer: it receives lines via takeLines() and
 * calls buf.notifyRender() so that rerender()/removeFromDom() can reach the DOM.
 */
export class Console {
    readonly format = new FormatState();

    private history: AnsiAwareBuffer[] = [];
    private pending:  AnsiAwareBuffer[] = [];
    private partial = new AnsiAwareBuffer();
    private cursorIdx = -1; // -1 = always resolve to last line
    // Persistent column position on the rendered-history cursor line. Tracked
    // independently of the active trigger lineBuffer (ScriptingAPI owns that).
    // moveUp/moveDown reset to 0 unless keepHorizontal is set; moveCursor/
    // moveTo set it explicitly. getCursorColumn clamps lazily to the current
    // line's length, so moves into shorter lines silently snap to end.
    private cursorCol = 0;
    private _maxLines = 1000;
    // Mudlet's setConsoleBufferSize takes a "size of batch deletion" — how many
    // lines it drops at once when the cap is exceeded. mudix evicts lazily down
    // to _maxLines (the observable cap is identical), but we round-trip the
    // value so getConsoleBufferSize reports back what a script set.
    private _batchDeleteSize = 1000;
    /** Mudlet `sysBufferShrinkEvent(name, linesRemoved)` hook. Fired by
     *  `evict()` whenever the scrollback cap drops one or more lines from the
     *  head of `history`. Set by the owning session (ScriptingAPI for "main",
     *  WindowManager for named user windows). */
    onBufferShrink: ((linesRemoved: number) => void) | undefined;
    // Mudlet's TConsole treats `\n` as cursor advance — `moveCursorEnd` followed
    // by `echo("\n")` advances past the last line without producing a blank row.
    // Mudix completes the (empty) partial on `\n` and emits a blank message.
    // Set after moveCursorEnd to consume one leading `\n` as cursor-advance.
    private consumeLeadingNewline = false;

    // ── Format state ──────────────────────────────────────────────────────────

    setFgColor(r: number, g: number, b: number): void {
        this.format.foreground = { space: 'rgb', r, g, b };
    }

    setBgColor(r: number, g: number, b: number, a?: number): void {
        this.format.background = a !== undefined && a < 255
            ? { space: 'rgb', r, g, b, a }
            : { space: 'rgb', r, g, b };
    }

    setBold(v: boolean):          void { this.format.bold          = v || undefined; }
    setItalic(v: boolean):        void { this.format.italic        = v || undefined; }
    setUnderline(v: boolean):     void { this.format.underline     = v || undefined; }
    setStrikethrough(v: boolean): void { this.format.strikethrough = v || undefined; }
    setOverline(v: boolean):      void { this.format.overline      = v || undefined; }
    setReverse(v: boolean):       void { this.format.inverse       = v || undefined; }

    resetFormat(): void { this.format.reset(); }

    get maxLines(): number { return this._maxLines; }
    setMaxLines(n: number): void { this._maxLines = n; this.evict(); }

    get batchDeleteSize(): number { return this._batchDeleteSize; }
    setBatchDeleteSize(n: number): void { this._batchDeleteSize = n; }

    // ── Output ────────────────────────────────────────────────────────────────

    echo(text: string): void {
        if (this.consumeLeadingNewline) {
            this.consumeLeadingNewline = false;
            if (text.startsWith('\n') && this.partial.text.length === 0) {
                text = text.slice(1);
                if (text.length === 0) return;
            }
        }
        this.partial.appendBuffer(new AnsiAwareBuffer(text, this.format.toSnapshot()));

        if (!this.partial.text.includes('\n')) return;

        const splits = this.partial.splitLines();
        const endsWithNewline = this.partial.text.endsWith('\n');
        const completeCount = endsWithNewline ? splits.length : splits.length - 1;

        for (let i = 0; i < completeCount; i++) {
            this.history.push(splits[i]);
            this.pending.push(splits[i]);
        }

        this.partial = endsWithNewline ? new AnsiAwareBuffer() : splits[splits.length - 1];
        this.evict();
    }

    /**
     * Append a pre-built complete line buffer to history. Used by the network
     * trigger pipeline: the line has already been parsed and is being added as
     * a single canonical entry, not via partial accumulation. The cursor is
     * placed on the new line at column 0 so triggers see Mudlet's "cursor on
     * the matching line at trigger fire" state. Does NOT enqueue into pending
     * — the renderer for network output drains via the 'message' event
     * pipeline; pending is reserved for script-driven echo flushes.
     */
    appendLine(buffer: AnsiAwareBuffer): void {
        this.history.push(buffer);
        this.cursorIdx = this.history.length - 1;
        this.cursorCol = 0;
        this.evict();
    }

    /**
     * Append a pre-formatted buffer as a new complete line — mirrors Mudlet's
     * TConsole::appendBuffer, the primitive behind the `appendBuffer`/`paste`
     * clipboard functions. Unlike `appendLine` (network pipeline) this also
     * enqueues into `pending` so the line reaches the renderer through the
     * normal drain path; the cursor resets to the end so a following
     * `selectCurrentLine` sees the pasted line.
     */
    appendBuffer(buffer: AnsiAwareBuffer): void {
        this.history.push(buffer);
        this.pending.push(buffer);
        this.cursorIdx = -1;
        this.cursorCol = 0;
        this.evict();
    }

    private evict(): void {
        let removed = 0;
        while (this.history.length > this._maxLines) {
            const evicted = this.history.shift()!;
            evicted.removeFromDom();
            if (this.cursorIdx > 0) this.cursorIdx--;
            removed++;
        }
        if (removed > 0) this.onBufferShrink?.(removed);
    }

    /** Drain newly completed lines to hand to the renderer. */
    takeLines(): AnsiAwareBuffer[] {
        const out = this.pending;
        this.pending = [];
        return out;
    }

    get currentPartial(): AnsiAwareBuffer { return this.partial; }

    /**
     * Promote the in-flight partial (an echo without a trailing newline, e.g.
     * a trigger's `cecho("\n text")`) into a finished history line and return
     * it, leaving a fresh empty partial behind. Returns null when nothing is
     * pending. Unlike `clear()`, the existing history is preserved so
     * line-number / selectString lookups for later lines in the same flush
     * batch stay valid — this is what lets a per-line trigger-echo flush place
     * the echoed line right after the line it was echoed on. The line is NOT
     * enqueued into `pending` (the caller emits it explicitly), so a following
     * `takeLines()` won't re-emit it.
     */
    completePartialLine(): AnsiAwareBuffer | null {
        if (this.partial.length === 0) return null;
        const buf = this.partial;
        this.history.push(buf);
        this.partial = new AnsiAwareBuffer();
        this.cursorIdx = -1;
        this.cursorCol = 0;
        this.evict();
        return buf;
    }

    clear(): void {
        this.history = [];
        this.pending = [];
        this.partial = new AnsiAwareBuffer();
        this.cursorIdx = -1;
        this.cursorCol = 0;
        this.consumeLeadingNewline = false;
    }

    // ── Cursor ────────────────────────────────────────────────────────────────

    private get cursor(): number {
        if (this.history.length === 0) return -1;
        if (this.cursorIdx < 0 || this.cursorIdx >= this.history.length) {
            return this.history.length - 1;
        }
        return this.cursorIdx;
    }

    getLine(): string { return this.history[this.cursor]?.text ?? ''; }
    getBuffer(): AnsiAwareBuffer | null { return this.history[this.cursor] ?? null; }

    /** Per-line prompt flag on the current cursor line. Mirrors Mudlet's TBuffer
     *  behaviour: `isPrompt()` follows the cursor, so moveCursor + isPrompt can
     *  inspect any historical line's prompt status, not just the most recent. */
    cursorOnPrompt(): boolean { return this.history[this.cursor]?.isPrompt ?? false; }

    deleteLine(): void {
        const idx = this.cursor;
        const buf = this.history[idx];
        if (!buf) return;
        buf.removeFromDom();
        this.history.splice(idx, 1);
        this.cursorIdx = Math.min(idx, this.history.length - 1);
    }

    /**
     * Move the cursor up `lines` rows. When `keepHorizontal` is false (the
     * default, matching Mudlet) the column resets to 0; when true the column
     * is preserved across the move and lazily clamps to the destination
     * line's length on read via `getCursorColumn`.
     */
    moveUp(lines: number = 1, keepHorizontal: boolean = false): boolean {
        const idx = this.cursor;
        if (idx <= 0) return false;
        const target = Math.max(0, idx - Math.max(1, Math.trunc(lines)));
        this.cursorIdx = target;
        if (!keepHorizontal) this.cursorCol = 0;
        return target !== idx;
    }

    moveDown(lines: number = 1, keepHorizontal: boolean = false): boolean {
        const idx = this.cursor;
        const last = this.history.length - 1;
        if (idx >= last) return false;
        const target = Math.min(last, idx + Math.max(1, Math.trunc(lines)));
        this.cursorIdx = target;
        if (!keepHorizontal) this.cursorCol = 0;
        return target !== idx;
    }

    /**
     * Seek the cursor to absolute line `line` (0-indexed). When `col` is
     * supplied, also set the column; otherwise the column is reset to 0 (the
     * Mudlet `moveCursor(x=0, y)` default).
     */
    moveTo(line: number, col: number = 0): boolean {
        if (this.history.length === 0) return false;
        if (!Number.isFinite(line) || line < 0) return false;
        if (!Number.isFinite(col) || col < 0) return false;
        this.cursorIdx = Math.min(Math.trunc(line), this.history.length - 1);
        this.cursorCol = Math.trunc(col);
        return true;
    }

    /**
     * Mudlet's `mUserCursor.x()` — the column on the cursor line. Lazily
     * clamped to the current line's length so a stale `cursorCol` from a
     * `keepHorizontal` move never reports past the end of a shorter line.
     */
    getCursorColumn(): number {
        const idx = this.cursor;
        if (idx < 0) return 0;
        const lineLen = this.history[idx]?.text.length ?? 0;
        return Math.min(this.cursorCol, lineLen);
    }

    setCursorColumn(col: number): boolean {
        if (!Number.isFinite(col) || col < 0) return false;
        this.cursorCol = Math.trunc(col);
        return true;
    }

    /** Mark cursor as positioned at the end of existing rendered content, so the
     *  next leading `\n` is treated as cursor advance rather than a blank line.
     *  Pass `false` to clear the latch (e.g. when leaving trigger processing) so
     *  it can't leak onto an unrelated later echo. */
    markCursorAtEnd(value: boolean = true): void {
        this.consumeLeadingNewline = value;
    }

    // Mudlet's TConsole returns 0-indexed cursor.y() for getLineNumber and
    // (size - 1) for getLineCount/getLastLineNumber. An empty buffer reports
    // line index -1 to match Mudlet's "no current line" sentinel.
    getLineNumber(): number { return this.cursor; }
    getLineCount(): number  { return this.history.length - 1; }

    getLines(from: number, to: number): string[] {
        return this.history.slice(from - 1, to).map(b => b.text);
    }

    /**
     * Mudlet `getTimestamp(lineNumber)` — the wall-clock time (epoch ms) the
     * line entered the buffer. `lineNumber` is 1-based to match `getLines`
     * (Mudlet's timeBuffer reserves index 0); omit it to read the current
     * cursor line. Returns null when the line is out of range or the buffer
     * is empty. Formatting into Mudlet's "hh:mm:ss.zzz" string happens one
     * layer up, in ScriptingAPI.
     */
    getLineTimestamp(lineNumber?: number): number | null {
        const idx = lineNumber === undefined ? this.cursor : Math.trunc(lineNumber) - 1;
        if (idx < 0) return null;
        return this.history[idx]?.timestamp ?? null;
    }

    /**
     * Mudlet `wrapLine(lineNumber)` — re-display the line at `lineNumber`
     * (0-indexed, matching getLineNumber/getLineCount), re-interpreting its
     * embedded `\n` characters and re-wrapping to the current width. mudix
     * renders each line buffer with CSS `white-space: pre-wrap`, and the
     * rendered DOM node holds the very same buffer object as history (set via
     * `notifyRender`), so re-rendering that buffer in place is what makes any
     * `\n` show as line breaks — the documented use case after a `deleteLine()`
     * + `echo()` sequence left un-displayed newlines in the buffer. Returns
     * false when `lineNumber` is out of range.
     */
    wrapLine(lineNumber: number): boolean {
        if (!Number.isFinite(lineNumber)) return false;
        const idx = Math.trunc(lineNumber);
        const buf = this.history[idx];
        if (!buf) return false;
        buf.rerender();
        return true;
    }
}
