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
    private _maxLines = 1000;

    // ── Format state ──────────────────────────────────────────────────────────

    setFgColor(r: number, g: number, b: number): void {
        this.format.foreground = { space: 'rgb', r, g, b };
    }

    setBgColor(r: number, g: number, b: number): void {
        this.format.background = { space: 'rgb', r, g, b };
    }

    setBold(v: boolean):          void { this.format.bold          = v || undefined; }
    setItalic(v: boolean):        void { this.format.italic        = v || undefined; }
    setUnderline(v: boolean):     void { this.format.underline     = v || undefined; }
    setStrikethrough(v: boolean): void { this.format.strikethrough = v || undefined; }

    resetFormat(): void { this.format.reset(); }

    get maxLines(): number { return this._maxLines; }
    setMaxLines(n: number): void { this._maxLines = n; this.evict(); }

    // ── Output ────────────────────────────────────────────────────────────────

    echo(text: string): void {
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

    private evict(): void {
        while (this.history.length > this._maxLines) {
            const evicted = this.history.shift()!;
            evicted.removeFromDom();
            if (this.cursorIdx > 0) this.cursorIdx--;
        }
    }

    /** Drain newly completed lines to hand to the renderer. */
    takeLines(): AnsiAwareBuffer[] {
        const out = this.pending;
        this.pending = [];
        return out;
    }

    get currentPartial(): AnsiAwareBuffer { return this.partial; }

    clear(): void {
        this.history = [];
        this.pending = [];
        this.partial = new AnsiAwareBuffer();
        this.cursorIdx = -1;
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

    deleteLine(): void {
        const idx = this.cursor;
        const buf = this.history[idx];
        if (!buf) return;
        buf.removeFromDom();
        this.history.splice(idx, 1);
        this.cursorIdx = Math.min(idx, this.history.length - 1);
    }

    moveUp(): void {
        const idx = this.cursor;
        if (idx > 0) this.cursorIdx = idx - 1;
    }

    moveDown(): void {
        const idx = this.cursor;
        if (idx < this.history.length - 1) this.cursorIdx = idx + 1;
    }

    moveTo(line: number): void {
        this.cursorIdx = Math.max(0, Math.min(line - 1, this.history.length - 1));
    }

    getLineNumber(): number { return this.cursor + 1; }
    getLineCount(): number  { return this.history.length; }

    getLines(from: number, to: number): string[] {
        return this.history.slice(from - 1, to).map(b => b.text);
    }
}
