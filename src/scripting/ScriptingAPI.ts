import type { MudSession, ScriptLogSource } from '../mud/MudSession';
import type { AliasEngine } from '../mud/aliases/AliasEngine';
import type { TriggerEngine } from '../mud/triggers/TriggerEngine';
import type { TimerEngine } from '../mud/timers/TimerEngine';
import type { KeyEngine } from '../mud/keybindings/KeyEngine';
import type { WindowHandle, WindowOpenOptions } from '../ui/windows/types';
import type { LabelManager, LabelCreateOptions } from '../ui/labels/LabelManager';
import { AnsiAwareBuffer, type FormatStateSnapshot, type FormatHyperlink } from '../mud/text/FormatState';
import { namedColorToState } from '../mud/text/colorParsers';
import { Console } from '../mud/text/Console';

// ── Windows ───────────────────────────────────────────────────────────────────

class ScriptingWindowsAPI {
    constructor(private readonly session: MudSession) {}

    open(id: string, options?: WindowOpenOptions): WindowHandle {
        return this.session.windows.open(id, options);
    }

    write(id: string, text: string): void {
        this.session.windows.write(id, text);
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

    isMiniConsole(id: string): boolean {
        return this.session.windows.isMiniConsole(id);
    }

    move(id: string, x: number, y: number): void {
        this.session.windows.setPosition(id, x, y);
    }

    resize(id: string, width: number, height: number): void {
        this.session.windows.setSize(id, width, height);
    }

    element(id: string): HTMLElement | null {
        return this.session.windows.getElement(id);
    }
}

// ── Labels ────────────────────────────────────────────────────────────────────

class ScriptingLabelsAPI {
    constructor(private readonly manager: LabelManager) {}

    create(name: string, opts: LabelCreateOptions): boolean {
        return this.manager.create(name, opts);
    }
    has(name: string): boolean { return this.manager.has(name); }
    destroy(name: string): boolean { return this.manager.destroy(name); }
    move(name: string, x: number, y: number): boolean {
        return this.manager.move(name, x, y);
    }
    resize(name: string, width: number, height: number): boolean {
        return this.manager.resize(name, width, height);
    }
    show(name: string): boolean { return this.manager.show(name); }
    hide(name: string): boolean { return this.manager.hide(name); }
    setHtml(name: string, html: string): boolean {
        return this.manager.setHtml(name, html);
    }
    setBackgroundColor(name: string, r: number, g: number, b: number, a = 255): boolean {
        return this.manager.setBackgroundColor(name, r, g, b, a);
    }
    setStyleSheet(name: string, css: string): boolean {
        return this.manager.setStyleSheet(name, css);
    }
    setClickCallback(name: string, fn: () => void): boolean {
        return this.manager.setClickCallback(name, fn);
    }
    setTooltip(name: string, text: string | undefined): boolean {
        return this.manager.setTooltip(name, text);
    }
    setClickThrough(name: string, value: boolean): boolean {
        return this.manager.setClickThrough(name, value);
    }
    setCursor(name: string, cursor: string | undefined): boolean {
        return this.manager.setCursor(name, cursor);
    }
    raise(name: string): boolean { return this.manager.raise(name); }
    lower(name: string): boolean { return this.manager.lower(name); }
}

// ── Main API ──────────────────────────────────────────────────────────────────

export class ScriptingAPI {
    readonly windows: ScriptingWindowsAPI;
    readonly labels: ScriptingLabelsAPI;
    readonly aliases: AliasEngine;
    readonly triggers: TriggerEngine;
    readonly gmcp: Record<string, unknown> = {};
    profileName = '';
    readonly timers: TimerEngine;
    readonly keys: KeyEngine;

    private readonly mainConsole = new Console();

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

    // Callback set by ScriptingEngine to route expandAlias through the full pipeline.
    private expandAliasCallback: ((text: string, echo: boolean) => void) | null = null;

    // Callback set by ScriptingEngine. Raises sysDataSendRequest and reports
    // whether a handler called denyCurrentSend().
    private sendRequestDispatcher: ((text: string) => boolean) | null = null;

    // Callback set by ScriptingEngine. Runs a synthetic flushLines batch
    // through the same pipeline as network-driven flushLines so feedTriggers
    // shares ordering semantics.
    private feedDispatcher: ((groups: { text: string; type: string }[]) => void) | null = null;

    private selection: { windowName: string | undefined; start: number; length: number } | null = null;

    constructor(
        private readonly session: MudSession,
        aliasEngine: AliasEngine,
        triggerEngine: TriggerEngine,
        timerEngine: TimerEngine,
        keyEngine: KeyEngine,
    ) {
        this.windows = new ScriptingWindowsAPI(session);
        this.labels = new ScriptingLabelsAPI(session.labels);
        this.aliases = aliasEngine;
        this.triggers = triggerEngine;
        this.timers = timerEngine;
        this.keys = keyEngine;
        session.consoles.set('main', this.mainConsole);
    }

    // ── Connection ────────────────────────────────────────────────────────────

    connect(url: string): void {
        this.session.connect(url);
    }

    disconnect(): void {
        this.session.disconnect();
    }

    send(text: string, echo = true): void {
        // sysDataSendRequest handlers may deny the send. If no dispatcher is
        // wired yet (early init), send straight.
        if (this.sendRequestDispatcher && this.sendRequestDispatcher(text)) return;
        this.session.send(text, echo);
    }

    setSendRequestDispatcher(fn: ((text: string) => boolean) | null): void {
        this.sendRequestDispatcher = fn;
    }

    setFeedDispatcher(fn: ((groups: { text: string; type: string }[]) => void) | null): void {
        this.feedDispatcher = fn;
    }

    // ── Echo / output ─────────────────────────────────────────────────────────

    echo(text: string): void {
        this.mainConsole.echo(text);
        this.drainMain();
    }

    echoToWindow(win: string, text: string): void {
        const con = this.outputConsole(win);
        con.echo(text);
        this.drainWindowConsole(win, con);
    }

    echoLink(text: string, cmd: string, tooltip: string, win?: string): void {
        if (!text) return;  // xEcho emits empty-text calls for colour-only segments
        const hyperlink: FormatHyperlink = {
            onClick: () => { this.executeScript?.(cmd); },
            title: tooltip || undefined,
        };
        const con = this.outputConsole(win);
        con.format.hyperlink = hyperlink;
        con.echo(text);
        con.format.hyperlink = undefined;
        if (!win || win === 'main') {
            this.drainMain();
        } else {
            this.drainWindowConsole(win, con);
        }
    }

    echoPopup(text: string, cmds: string[], hints: string[], win?: string): void {
        const onContextMenu = (ev: MouseEvent) => {
            ev.preventDefault();
            document.getElementById('mudix-popup-menu')?.remove();

            const menu = document.createElement('div');
            menu.id = 'mudix-popup-menu';
            menu.style.cssText = 'position:fixed;z-index:9999;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:2px 0;box-shadow:0 2px 10px rgba(0,0,0,0.7);min-width:120px;font-family:monospace;font-size:13px';
            menu.style.left = `${ev.clientX}px`;
            menu.style.top = `${ev.clientY}px`;

            cmds.forEach((cmd, i) => {
                const item = document.createElement('div');
                item.textContent = hints[i] ?? cmd;
                item.style.cssText = 'padding:5px 14px;cursor:pointer;color:#ddd;white-space:nowrap';
                item.addEventListener('mouseenter', () => { item.style.background = '#2a4a6e'; });
                item.addEventListener('mouseleave', () => { item.style.background = ''; });
                item.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    menu.remove();
                    this.executeScript?.(cmd);
                });
                menu.appendChild(item);
            });

            document.body.appendChild(menu);

            const dismiss = (e: MouseEvent) => {
                if (!menu.contains(e.target as Node)) {
                    menu.remove();
                    document.removeEventListener('mousedown', dismiss);
                }
            };
            setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
        };

        const hyperlink: FormatHyperlink = { onContextMenu, title: hints[0] ?? '' };
        const con = this.outputConsole(win);
        con.format.hyperlink = hyperlink;
        con.echo(text);
        con.format.hyperlink = undefined;
        if (!win || win === 'main') {
            this.drainMain();
        } else {
            this.drainWindowConsole(win, con);
        }
    }

    setExecuteScript(fn: ((code: string) => void) | null): void {
        this.executeScript = fn;
    }

    setExpandAlias(fn: ((text: string, echo: boolean) => void) | null): void {
        this.expandAliasCallback = fn;
    }

    expandAlias(text: string, echo: boolean): void {
        if (this.expandAliasCallback) {
            this.expandAliasCallback(text, echo);
        } else {
            this.send(text, echo);
        }
    }

    // ── Format state ──────────────────────────────────────────────────────────
    // Mirrors Mudlet's TConsole::setFgColor/setBgColor/setDisplayAttributes:
    // every call applies the format to the active selection (if any) AND sets
    // the current pen on the resolved console for subsequent echo.

    setFgColor(r: number, g: number, b: number, win?: string): void {
        if (this.selectionMatches(win)) {
            this.applyStateToSelection({ foreground: { space: 'rgb', r, g, b } });
        }
        this.outputConsole(win).setFgColor(r, g, b);
    }

    setBgColor(r: number, g: number, b: number, win?: string): void {
        if (this.selectionMatches(win)) {
            this.applyStateToSelection({ background: { space: 'rgb', r, g, b } });
        }
        this.outputConsole(win).setBgColor(r, g, b);
    }

    setBold(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ bold: v });
        this.outputConsole(win).setBold(v);
    }
    setItalic(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ italic: v });
        this.outputConsole(win).setItalic(v);
    }
    setUnderline(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ underline: v });
        this.outputConsole(win).setUnderline(v);
    }
    setStrikethrough(v: boolean, win?: string): void {
        if (this.selectionMatches(win)) this.applyStateToSelection({ strikethrough: v });
        this.outputConsole(win).setStrikethrough(v);
    }

    // ── Formatting (selection-aware) ──────────────────────────────────────────

    fg(name: string, win?: string): void {
        const state = namedColorToState(name, false);
        if (!state || state.foreground?.space !== 'rgb') return;
        const c = state.foreground;
        this.setFgColor(c.r, c.g, c.b, win);
    }

    bg(name: string, win?: string): void {
        const state = namedColorToState(name, true);
        if (!state || state.background?.space !== 'rgb') return;
        const c = state.background;
        this.setBgColor(c.r, c.g, c.b, win);
    }

    resetFormat(windowName?: string): void {
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
        this.outputConsole(windowName).resetFormat();
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    selectString(str: string, occurrence: number, windowName?: string): number {
        const isMain = !windowName || windowName === 'main';
        const line = (this.lineBuffer && isMain)
            ? this.lineBuffer.text
            : (this.getConsole(windowName)?.getLine() ?? '');

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
        // Mudlet: 0-indexed `from`. See TConsole::selectSection.
        this.selection = { windowName, start: from, length };
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
            this.session.events.emit('message', line, 'trigger-echo');
        }
        this.echoDeferred = [];
        const partial = this.mainConsole.currentPartial;
        if (partial.length > 0) {
            this.session.events.emit('message', partial, 'trigger-echo');
            this.mainConsole.clear();
        }
        this.session.windows.flushAllLines();
    }

    // ── Triggers ──────────────────────────────────────────────────────────────

    /**
     * Feed `text` through the trigger pipeline as if it arrived from the MUD.
     * Routes complete lines through ScriptingEngine.processFlushBatch (same
     * code path as network-driven flushLines) so trigger ordering, ANSI carry,
     * and deferred-echo placement match exactly.
     */
    feedTriggers(text: string): void {
        const lines = text.split('\n');
        const remainder = lines[lines.length - 1];
        const completeLines = lines.slice(0, -1);

        if (completeLines.length === 0) {
            this.mainConsole.echo(text);
            this.drainMain();
            const partial = this.mainConsole.currentPartial;
            if (partial.length > 0) this.session.events.emit('message', partial, 'script-partial');
            return;
        }

        // Wipe any stray partial left by direct echo() calls so trigger echo
        // accumulates fresh during batch processing.
        this.mainConsole.clear();

        if (this.feedDispatcher) {
            this.feedDispatcher([{ text: completeLines.join('\n'), type: 'mud' }]);
        } else {
            // Engine not wired yet (early init): fall back to a raw event.
            this.session.events.emit('flushLines', [{ text: completeLines.join('\n'), type: 'mud' }]);
        }

        if (remainder) {
            this.mainConsole.echo(remainder);
            this.drainMain();
        }
        const partial = this.mainConsole.currentPartial;
        if (partial.length > 0) this.session.events.emit('message', partial, 'script-partial');
    }

    // ── Cursor / line access ──────────────────────────────────────────────────

    getCurrentLine(windowName?: string): string {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain) return this.lineBuffer.text;
        return this.getConsole(windowName)?.getLine() ?? '';
    }

    getLineNumber(windowName?: string): number {
        return this.getConsole(windowName)?.getLineNumber() ?? 0;
    }

    getLineCount(windowName?: string): number {
        return this.getConsole(windowName)?.getLineCount() ?? 0;
    }

    getLines(from: number, to: number, windowName?: string): string[] {
        return this.getConsole(windowName)?.getLines(from, to) ?? [];
    }

    getColumnNumber(_windowName?: string): number {
        // Mudlet returns the user cursor column (mUserCursor.x()), independent of
        // the active selection. Trigger handlers run with the cursor at column 0.
        return 0;
    }

    insertText(text: string): void {
        this.mainConsole.echo(text);
        this.drainMain();
    }

    moveCursorUp(windowName?: string): void {
        this.getConsole(windowName)?.moveUp();
    }

    moveCursorDown(windowName?: string): void {
        this.getConsole(windowName)?.moveDown();
    }

    moveCursor(windowName: string | undefined, _x: number, y: number): void {
        this.getConsole(windowName)?.moveTo(y);
    }

    moveCursorEnd(windowName?: string): void {
        const con = this.getConsole(windowName);
        if (!con) return;
        con.moveTo(con.getLineCount());
        con.markCursorAtEnd();
    }

    // ── Window / line management ──────────────────────────────────────────────

    clearWindow(name?: string): void {
        if (!name || name === 'main') {
            this.session.events.emit('script.clearwindow');
        } else {
            this.session.windows.clear(name);
        }
    }

    /**
     * Mudlet `createMiniConsole([parent,] name, x, y, width, height)`. Creates
     * a positioned floating text panel, or repositions it if it already exists
     * (Mudlet 3.0+ semantics). The optional `parent` userwindow arg is accepted
     * for compatibility with Geyser but treated as main — nested miniconsoles
     * aren't supported. Returns true on success.
     */
    createMiniConsole(name: string, x: number, y: number, width: number, height: number, _parent?: string): boolean {
        if (!name) return false;
        const wm = this.session.windows;
        if (!wm.has(name)) {
            wm.open(name, {
                kind: 'text',
                title: name,
                autoDock: false,
                ignoreHint: true,
            });
        } else {
            wm.show(name);
        }
        wm.markAsMiniConsole(name);
        wm.setPosition(name, Math.round(x), Math.round(y));
        wm.setSize(name, Math.round(width), Math.round(height));
        return true;
    }

    replace(newText: string, windowName?: string): void {
        if (!this.selection) return;
        const sel = this.selection;
        const buf = this.resolveBuffer(windowName ?? sel.windowName);
        if (!buf) return;
        buf.replace([sel.start, sel.start + sel.length], newText);
        this.selection = null;
        if (!this.lineBuffer) buf.rerender();
    }

    deleteLine(windowName?: string): void {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain) {
            this.lineBuffer.markAsDeleted();
            return;
        }
        this.getConsole(windowName)?.deleteLine();
    }

    appendCmdLine(text: string): void {
        this.session.events.emit('script.appendcmd', text);
    }

    printCmdLine(text: string): void {
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

    getNetworkLatency(): number {
        return this.session.ping ?? 0;
    }

    getMainWindowSize(): [number, number] {
        return [window.innerWidth, window.innerHeight];
    }

    /** Flush any buffered partial lines to the main output and all open windows. Called after each event dispatch. */
    flushOutput(): void {
        if (!this.isDeferringEcho) {
            const partial = this.mainConsole.currentPartial;
            if (partial.length > 0) this.session.events.emit('message', partial, 'script-partial');
        }
        this.session.windows.flushAllLines();
    }

    /** @deprecated use echo() */
    print(text: string): void {
        this.echo(text);
    }

    printError(text: string, source?: ScriptLogSource): void {
        this.session.events.emit('script.log', text, 'error', source);
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

    private getConsole(name?: string): Console | null {
        return this.session.consoles.get(name ?? 'main') ?? null;
    }

    /** Returns the Console for a window, creating and registering one on demand. */
    private outputConsole(win?: string): Console {
        if (!win || win === 'main') return this.mainConsole;
        let con = this.session.consoles.get(win);
        if (!con) {
            con = new Console();
            this.session.consoles.set(win, con);
        }
        return con;
    }

    private drainWindowConsole(win: string, con: Console): void {
        for (const line of con.takeLines()) {
            this.session.windows.pushBuffer(win, line);
        }
    }

    private resolveBuffer(windowName: string | undefined): AnsiAwareBuffer | null {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain) return this.lineBuffer;
        return this.getConsole(windowName)?.getBuffer() ?? null;
    }

    private selectionMatches(win: string | undefined): boolean {
        if (!this.selection) return false;
        const selMain = !this.selection.windowName || this.selection.windowName === 'main';
        const argMain = !win || win === 'main';
        if (selMain && argMain) return true;
        return this.selection.windowName === win;
    }

    private applyStateToSelection(state: FormatStateSnapshot | null): void {
        if (!this.selection || !state) return;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return;
        buf.applyFormat([sel.start, sel.start + sel.length], state);
        // Only rerender if already in the DOM (post-trigger path).
        if (!this.lineBuffer) buf.rerender();
    }

    private drainMain(): void {
        for (const line of this.mainConsole.takeLines()) {
            if (this.isDeferringEcho) {
                this.echoDeferred.push(line);
            } else {
                this.session.events.emit('message', line, 'script');
            }
        }
    }
}
