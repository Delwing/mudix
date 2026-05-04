import type { MudSession } from '../mud/MudSession';
import type { AliasEngine } from '../mud/aliases/AliasEngine';
import type { TriggerEngine } from '../mud/triggers/TriggerEngine';
import type { WindowHandle, WindowOpenOptions } from '../ui/windows/types';
import { AnsiAwareBuffer, FormatState, type FormatStateSnapshot, type FormatHyperlink } from '../mud/text/FormatState';
import { namedColorToAnsi, namedColorToState, parseCecho, parseDecho, parseHecho } from '../mud/text/colorParsers';

// ── Windows ───────────────────────────────────────────────────────────────────

class ScriptingWindowsAPI {
    constructor(private readonly session: MudSession) {}

    open(id: string, options?: WindowOpenOptions): WindowHandle {
        return this.session.windows.open(id, options);
    }

    write(id: string, text: string): void {
        this.session.windows.write(id, text);
    }

    cecho(id: string, text: string): void {
        this.session.windows.write(id, parseCecho(text));
    }

    decho(id: string, text: string): void {
        this.session.windows.write(id, parseDecho(text));
    }

    hecho(id: string, text: string): void {
        this.session.windows.write(id, parseHecho(text));
    }

    clear(id: string): void {
        this.session.windows.clear(id);
    }

    setTitle(id: string, title: string): void {
        this.session.windows.setTitle(id, title);
    }

    focus(id: string): void {
        this.session.windows.focus(id);
    }

    hide(id: string): void {
        this.session.windows.hide(id);
    }

    show(id: string): void {
        this.session.windows.show(id);
    }

    close(id: string): void {
        this.session.windows.close(id);
    }

    has(id: string): boolean {
        return this.session.windows.has(id);
    }

    isVisible(id: string): boolean {
        return this.session.windows.isVisible(id);
    }

    element(id: string): HTMLElement | null {
        return this.session.windows.getElement(id);
    }
}

// ── Main API ──────────────────────────────────────────────────────────────────

export class ScriptingAPI {
    readonly windows: ScriptingWindowsAPI;
    readonly aliases: AliasEngine;
    readonly triggers: TriggerEngine;
    readonly gmcp: Record<string, unknown> = {};

    // Buffers a partial (no-trailing-newline) echo line across calls.
    private mainOutputBuffer: AnsiAwareBuffer = new AnsiAwareBuffer();
    // Tracks the current ANSI formatting state so it carries across separate bufferText calls.
    private currentAnsiState: FormatState = new FormatState();

    // During trigger processing, holds the line buffer being built. When set,
    // selectString/fg/bg/resetFormat/deleteLine operate on this buffer instead
    // of the already-rendered DOM. Set to null between lines.
    private lineBuffer: AnsiAwareBuffer | null = null;

    // While lineBuffer is active, echo/cecho output is held here and flushed
    // to the output *after* the triggering line (or batch) is rendered.
    private echoDeferred: AnsiAwareBuffer[] = [];
    private isDeferringEcho = false;

    // Callback set by ScriptingEngine so link clicks can execute Lua code.
    private executeScript: ((code: string) => void) | null = null;

    private selection: { windowName: string | undefined; start: number; length: number } | null = null;

    constructor(private readonly session: MudSession, aliasEngine: AliasEngine, triggerEngine: TriggerEngine) {
        this.windows = new ScriptingWindowsAPI(session);
        this.aliases = aliasEngine;
        this.triggers = triggerEngine;
    }

    // ── Connection ────────────────────────────────────────────────────────────

    connect(url: string): void {
        this.session.connect(url);
    }

    disconnect(): void {
        this.session.disconnect();
    }

    send(text: string, echo = true): void {
        this.session.send(text, echo);
    }

    // ── Echo / output ─────────────────────────────────────────────────────────

    echo(text: string): void {
        this.bufferText(text);
    }

    cecho(text: string): void {
        this.bufferText(parseCecho(text));
    }

    decho(text: string): void {
        this.bufferText(parseDecho(text));
    }

    hecho(text: string): void {
        this.bufferText(parseHecho(text));
    }

    echoLink(text: string, luaCmd: string, tooltip: string): void {
        const hyperlink: FormatHyperlink = {
            onClick: () => { this.executeScript?.(luaCmd); },
            title: tooltip || undefined,
        };
        const state: FormatStateSnapshot = { ...this.currentAnsiState.toSnapshot(), hyperlink };
        const buf = new AnsiAwareBuffer();
        buf.append(text, state);
        this.appendToOutputBuffer(buf);
    }

    setExecuteScript(fn: ((code: string) => void) | null): void {
        this.executeScript = fn;
    }

    // ── Formatting (selection-aware) ──────────────────────────────────────────

    fg(name: string): void {
        if (this.selection) {
            const state = namedColorToState(name, false);
            if (state) this.applyStateToSelection(state);
            return;
        }
        this.bufferText(namedColorToAnsi(name, false));
    }

    bg(name: string): void {
        if (this.selection) {
            const state = namedColorToState(name, true);
            if (state) this.applyStateToSelection(state);
            return;
        }
        this.bufferText(namedColorToAnsi(name, true));
    }

    resetFormat(): void {
        if (this.selection) {
            const sel = this.selection;
            this.selection = null;
            const buf = this.resolveBuffer(sel.windowName);
            if (buf) {
                buf.clearFormat([sel.start, sel.start + sel.length]);
                if (!this.lineBuffer) buf.rerender();
            }
            return;
        }
        this.bufferText('\x1b[0m');
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    selectString(str: string, occurrence: number, windowName?: string): number {
        const isMain = !windowName || windowName === 'main';
        const line = (this.lineBuffer && isMain)
            ? this.lineBuffer.text
            : (this.getWindowCursor(windowName ?? 'main')?.getLine() ?? '');

        let count = 0;
        let searchFrom = 0;
        while (searchFrom <= line.length - str.length) {
            const idx = line.indexOf(str, searchFrom);
            if (idx === -1) break;
            count++;
            if (count === occurrence) {
                this.selection = { windowName, start: idx, length: str.length };
                return idx;
            }
            searchFrom = idx + str.length;
        }
        return -1;
    }

    selectSection(from: number, length: number, windowName?: string): void {
        this.selection = { windowName, start: from - 1, length };
    }

    deselect(): void {
        this.selection = null;
    }

    applyFormatToSelection(state: FormatStateSnapshot): void {
        this.applyStateToSelection(state);
    }

    // ── Trigger pipeline hooks (called by ScriptingEngine) ────────────────────

    /**
     * Called before trigger processing for each incoming line. Installs the
     * buffer so that selectString/fg/bg/deleteLine modify it in-place before
     * render. Also enables echo deferral so trigger echo output appears after
     * the rendered line rather than before it.
     */
    setLineBuffer(buffer: AnsiAwareBuffer): void {
        this.lineBuffer = buffer;
        this.selection = null;
        this.isDeferringEcho = true;
    }

    /**
     * Called after all triggers for a line have run (but before render).
     * Clears the pre-render buffer reference; echo deferral stays active until
     * flushDeferredEcho() is called.
     */
    clearLineBuffer(): void {
        this.lineBuffer = null;
        this.selection = null;
    }

    /**
     * Called after all lines in a flushLines batch have been rendered. Emits
     * any echo output collected during trigger processing, in order, after the
     * rendered lines.
     */
    flushDeferredEcho(): void {
        this.isDeferringEcho = false;
        for (const line of this.echoDeferred) {
            // 'trigger-echo' type: trigger-mode output that always creates a fresh element,
            // never combining with any existing timer-cecho partial.
            this.session.events.emit('message', line, 'trigger-echo');
        }
        this.echoDeferred = [];
        if (this.mainOutputBuffer.length > 0) {
            // Trigger's partial echo also becomes a finalized element. Mudlet inserts
            // it inline via insertInLine(), but in DOM terms a separate element is the
            // closest equivalent. Clearing the buffer lets the next timer cecho start
            // fresh on a new partial line (matching Mudlet's "new empty line" step).
            this.session.events.emit('message', this.mainOutputBuffer, 'trigger-echo');
            this.mainOutputBuffer = new AnsiAwareBuffer();
            this.currentAnsiState.reset();
        }
        this.session.windows.flushAllLines();
    }

    // ── Triggers ──────────────────────────────────────────────────────────────

    /**
     * Feed `text` through the trigger pipeline as if it arrived from the MUD.
     * ScriptingEngine's flushLines handler takes care of both rendering (via
     * 'message') and trigger processing, so we only emit flushLines here.
     */
    feedTriggers(text: string): void {
        const lines = text.split('\n');
        const remainder = lines[lines.length - 1];
        const completeLines = lines.slice(0, -1);

        if (completeLines.length === 0) {
            // No newlines — append to the partial buffer just like cecho, no triggers fired.
            this.bufferText(text);
            if (this.mainOutputBuffer.length > 0) {
                this.session.events.emit('message', this.mainOutputBuffer, 'script-partial');
            }
            return;
        }

        // Complete lines present. The existing partial (timer cecho etc.) stays in the DOM
        // as-is — do NOT combine it with feedTriggers text (they are independent streams).
        // Clear the buffer so flushDeferredEcho accumulates trigger echo output fresh.
        this.mainOutputBuffer = new AnsiAwareBuffer();
        this.currentAnsiState.reset();

        this.session.events.emit('flushLines', [{ text: completeLines.join('\n'), type: 'mud' }]);

        // After flushLines, mainOutputBuffer holds whatever trigger callbacks echoed.
        // Append the feedTriggers remainder (text after the last \n) to that.
        if (remainder) this.bufferText(remainder);
        if (this.mainOutputBuffer.length > 0) {
            this.session.events.emit('message', this.mainOutputBuffer, 'script-partial');
        }
    }

    // ── Cursor / line access ──────────────────────────────────────────────────

    getCurrentLine(windowName?: string): string {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain) return this.lineBuffer.text;
        return this.getWindowCursor(windowName)?.getLine() ?? '';
    }

    getLineNumber(windowName?: string): number {
        return this.getWindowCursor(windowName)?.getLineNumber() ?? 0;
    }

    getLineCount(windowName?: string): number {
        return this.getWindowCursor(windowName)?.getLineCount() ?? 0;
    }

    getLines(from: number, to: number, windowName?: string): string[] {
        return this.getWindowCursor(windowName)?.getLines(from, to) ?? [];
    }

    getColumnNumber(windowName?: string): number {
        if (this.selection && this.selection.windowName === windowName) {
            return this.selection.start + 1;
        }
        return 0;
    }

    insertText(text: string): void {
        this.bufferText(text);
    }

    moveCursorUp(windowName?: string): void {
        if (windowName && windowName !== 'main') {
            this.getWindowCursor(windowName)?.moveUp();
        } else {
            this.session.events.emit('script.movecursorup');
        }
    }

    moveCursorDown(windowName?: string): void {
        if (windowName && windowName !== 'main') {
            this.getWindowCursor(windowName)?.moveDown();
        } else {
            this.session.events.emit('script.movecursordown');
        }
    }

    moveCursor(windowName: string | undefined, x: number, y: number): void {
        this.getWindowCursor(windowName)?.moveTo(y);
    }

    // ── Window / line management ──────────────────────────────────────────────

    clearWindow(name?: string): void {
        if (!name || name === 'main') {
            this.session.events.emit('script.clearwindow');
        } else {
            this.session.windows.clear(name);
        }
    }

    deleteLine(windowName?: string): void {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain) {
            // Pre-render: mark buffer so ScriptingEngine skips the render step.
            this.lineBuffer.markAsDeleted();
            return;
        }
        if (windowName && windowName !== 'main') {
            this.getWindowCursor(windowName)?.deleteLine();
        } else {
            this.session.events.emit('script.deleteline');
        }
    }

    appendCmdLine(text: string): void {
        this.session.events.emit('script.appendcmd', text);
    }

    setCmdLine(text: string): void {
        this.session.events.emit('script.setcmd', text);
    }

    centerView(roomId: number): void {
        this.session.windows.centerView(roomId);
    }

    getRoomIDbyHash(hash: string): number | undefined {
        return this.session.windows.getRoomIDbyHash(hash);
    }

    // ── Map scripting API ─────────────────────────────────────────────────────

    get map() { return this.session.windows.mapStore; }

    // ── Misc ──────────────────────────────────────────────────────────────────

    /** Flush any buffered partial lines to the main output and all open windows. Called after each event dispatch. */
    flushOutput(): void {
        // During trigger processing, don't emit the main buffer — it's deferred
        // until flushDeferredEcho() is called after render.
        if (!this.isDeferringEcho && this.mainOutputBuffer.length > 0) {
            // Emit as partial — the renderer appends inline to the current line.
            // Do NOT clear mainOutputBuffer: bufferText clears it naturally when
            // a complete line (with \n) is formed, so subsequent cecho calls still
            // combine with the accumulated partial text via `combined = buffer + text`.
            this.session.events.emit('message', this.mainOutputBuffer, 'script-partial');
        }
        this.session.windows.flushAllLines();
    }

    /** @deprecated use echo() */
    print(text: string): void {
        this.echo(text);
    }

    printError(text: string): void {
        this.session.events.emit('script.log', text, 'error');
    }

    updateGmcp(path: string, value: unknown): void {
        const parts = path.split('.');
        let node = this.gmcp as Record<string, unknown>;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            if (typeof node[key] !== 'object' || node[key] === null) {
                node[key] = {};
            }
            node = node[key] as Record<string, unknown>;
        }
        node[parts[parts.length - 1]] = value;
    }

    destroy(): void {
        this.flushOutput();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private getWindowCursor(name?: string) {
        return this.session.windowCursors.get(name ?? 'main') ?? null;
    }

    /**
     * Returns the buffer to target for selection operations. During trigger
     * processing (lineBuffer set), that's the pre-render buffer. Otherwise it's
     * the already-rendered DOM buffer via cursor ops.
     */
    private resolveBuffer(windowName: string | undefined): AnsiAwareBuffer | null {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain) return this.lineBuffer;
        return this.getWindowCursor(windowName ?? 'main')?.getBuffer() ?? null;
    }

    private applyStateToSelection(state: ReturnType<typeof namedColorToState>): void {
        if (!this.selection || !state) return;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return;
        buf.applyFormat([sel.start, sel.start + sel.length], state);
        // Only rerender if already in the DOM (post-trigger path).
        if (!this.lineBuffer) buf.rerender();
    }

    // Split on newlines: emit each complete line, buffer the remainder.
    // During trigger processing, complete lines go into echoDeferred instead
    // of being emitted immediately, so they appear after the triggering lines.
    private bufferText(text: string): void {
        const buf = new AnsiAwareBuffer(text, this.currentAnsiState.toSnapshot());
        this.updateAnsiState(text);
        this.appendToOutputBuffer(buf);
    }

    private appendToOutputBuffer(buf: AnsiAwareBuffer): void {
        this.mainOutputBuffer.appendBuffer(buf);
        const text = this.mainOutputBuffer.text;
        if (!text.includes('\n')) return;
        const lines = this.mainOutputBuffer.splitLines();
        // splitLines() on "text\n" returns ["text"] (1 element, no trailing empty).
        // Detect whether the buffer ended with \n to know if all elements are complete.
        const endsWithNewline = text.endsWith('\n');
        const completeCount = endsWithNewline ? lines.length : lines.length - 1;
        for (let i = 0; i < completeCount; i++) {
            if (this.isDeferringEcho) {
                this.echoDeferred.push(lines[i]);
            } else {
                this.session.events.emit('message', lines[i], 'script');
            }
        }
        this.mainOutputBuffer = endsWithNewline ? new AnsiAwareBuffer() : lines[lines.length - 1];
    }

    private updateAnsiState(text: string): void {
        const ESC = '\x1b';
        for (let i = 0; i < text.length; i++) {
            if (text[i] === ESC && text[i + 1] === '[') {
                const end = text.indexOf('m', i + 2);
                if (end === -1) break;
                const seq = text.slice(i + 2, end);
                this.currentAnsiState.applySgr(
                    seq.split(';').filter(s => s.length > 0).map(s => parseInt(s, 10) || 0)
                );
                i = end;
            }
        }
    }
}
