import type { MudSession } from '../mud/MudSession';
import type { AliasEngine } from '../mud/aliases/AliasEngine';
import type { TriggerEngine } from '../mud/triggers/TriggerEngine';
import type { WindowHandle, WindowOpenOptions } from '../ui/windows/types';
import { namedColorToAnsi, parseCecho, parseDecho, parseHecho } from '../mud/text/colorParsers';

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
    // Buffers partial lines for echo/cecho/decho/hecho — always routes to the main output panel.
    // windows.write() bypasses this entirely, so there is no per-window buffering needed.
    private mainOutputBuffer = '';

    constructor(private readonly session: MudSession, aliasEngine: AliasEngine, triggerEngine: TriggerEngine) {
        this.windows = new ScriptingWindowsAPI(session);
        this.aliases = aliasEngine;
        this.triggers = triggerEngine;
    }

    connect(url: string): void {
        this.session.connect(url);
    }

    disconnect(): void {
        this.session.disconnect();
    }

    send(text: string, echo = true): void {
        this.session.send(text, echo);
    }

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

    fg(name: string): void {
        this.bufferText(namedColorToAnsi(name, false));
    }

    bg(name: string): void {
        this.bufferText(namedColorToAnsi(name, true));
    }

    resetFormat(): void {
        this.bufferText('\x1b[0m');
    }

    /**
     * Feed `text` through the trigger pipeline as if it arrived from the MUD.
     * ScriptingEngine's flushLines handler takes care of both rendering (via
     * 'message') and trigger processing, so we only emit flushLines here.
     */
    feedTriggers(text: string): void {
        this.flushOutput();
        this.session.events.emit('flushLines', [{ text, type: 'mud' }]);
    }

    private getWindowCursor(name?: string) {
        return this.session.windowCursors.get(name ?? 'main') ?? null;
    }

    getCurrentLine(windowName?: string): string {
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

    getColumnNumber(_windowName?: string): number {
        // In-line column cursor is not yet tracked; return 0.
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

    /** Flush any buffered partial lines to the main output and all open windows. Called after each event dispatch. */
    flushOutput(): void {
        if (this.mainOutputBuffer.length > 0) {
            this.session.events.emit('message', this.mainOutputBuffer, 'script');
            this.mainOutputBuffer = '';
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

    clearWindow(name?: string): void {
        if (!name || name === 'main') {
            this.session.events.emit('script.clearwindow');
        } else {
            this.session.windows.clear(name);
        }
    }

    deleteLine(windowName?: string): void {
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

    destroy(): void {
        this.flushOutput();
    }

    // Split on newlines: emit each complete line immediately, buffer the remainder.
    private bufferText(text: string): void {
        const combined = this.mainOutputBuffer + text;
        const lines = combined.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
            this.session.events.emit('message', lines[i], 'script');
        }
        this.mainOutputBuffer = lines[lines.length - 1];
    }
}
