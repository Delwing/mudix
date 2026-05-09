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
import { useAppStore } from '../storage';

/**
 * Returns how many monospace characters fit horizontally inside `el`. Used by
 * getColumnCount when the script hasn't pinned a wrap width with setWindowWrap.
 * The probe is hidden and removed before this returns, so it never appears in
 * the output. Returns 0 if the element is missing or has zero width (e.g. not
 * yet mounted, in a hidden tab).
 */
function measureColumnCapacity(el: HTMLElement | null): number {
    if (!el) return 0;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(100);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;letter-spacing:inherit;';
    el.appendChild(probe);
    const charWidth = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (charWidth <= 0) return 0;
    const cs = getComputedStyle(el);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const width = Math.max(0, el.clientWidth - pad);
    return Math.floor(width / charWidth);
}

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

    setFontSize(id: string, size: number): boolean {
        return this.session.windows.setFontSize(id, size);
    }

    getFontSize(id: string): number | null {
        return this.session.windows.getFontSize(id);
    }

    setFont(id: string, family: string): boolean {
        return this.session.windows.setFont(id, family);
    }

    getFont(id: string): string | null {
        return this.session.windows.getFont(id);
    }

    setBackgroundColor(id: string, r: number, g: number, b: number, a = 255): boolean {
        return this.session.windows.setBackgroundColor(id, r, g, b, a);
    }

    getBackgroundColor(id: string): { r: number; g: number; b: number; a: number } | null {
        return this.session.windows.getBackgroundColor(id);
    }

    element(id: string): HTMLElement | null {
        return this.session.windows.getElement(id);
    }
}

// ── Labels ────────────────────────────────────────────────────────────────────

class ScriptingLabelsAPI {
    constructor(
        private readonly manager: LabelManager,
        private readonly cssRewriter: () => ((css: string) => string) | null,
    ) {}

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
    getBackgroundColor(name: string): { r: number; g: number; b: number; a: number } | null {
        return this.manager.getBackgroundColor(name);
    }
    setStyleSheet(name: string, css: string): boolean {
        const rewrite = this.cssRewriter();
        return this.manager.setStyleSheet(name, rewrite ? rewrite(css) : css);
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

    // The 0-indexed line position the lineBuffer occupies in the conceptual
    // (rendered + in-flight) buffer. Mudlet treats the matching line as a
    // regular line in the console; mudix holds it separately until render, so
    // we expose it as a virtual index one past the last rendered line. Set on
    // setLineBuffer; cleared on clearLineBuffer.
    private lineBufferLineIndex: number | null = null;

    // Tracks where the user-facing cursor "is" while a lineBuffer is active.
    // Initially true (trigger fires with cursor on the matching line); flips
    // to false the moment moveCursor/moveCursorUp/moveCursorDown moves the
    // cursor onto a rendered-history line, so subsequent insertText/replace/
    // getCurrentLine/getColumnNumber follow the cursor rather than always
    // targeting the lineBuffer. moveCursor back to lineBufferLineIndex flips
    // it true again.
    private cursorOnLineBuffer = false;

    // Column cursor for the active lineBuffer. Set by moveCursor and read by
    // getColumnNumber so xEcho's "moveCursor(getColumnNumber + len(seg), ...)"
    // dance threads inserts in order. Mudlet's prefix() drives this: it calls
    // moveCursor(0, lineN) then cinsertText, which routes per-segment writes
    // through insertText(win, seg) — those need to land at cursorCol, not at
    // the end of the buffer.
    private cursorCol = 0;

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

    // Callbacks set by ScriptingEngine. Wire installPackage / uninstallPackage
    // through to the engine so the package's items reach the appStore (and
    // thus the runtime) and sysInstall* / sysUninstall* events fire in order.
    private packageInstaller: ((path: string) => boolean) | null = null;
    private packageUninstaller: ((name: string) => boolean) | null = null;
    private packagesGetter: (() => string[]) | null = null;
    private moduleInstaller: ((path: string) => boolean) | null = null;
    private moduleUninstaller: ((name: string) => boolean) | null = null;
    private moduleSyncer: ((name: string) => Promise<void>) | null = null;
    private moduleReloader: ((name: string) => boolean) | null = null;
    private moduleSyncSetter: ((name: string, sync: boolean) => void) | null = null;
    private moduleSyncGetter: ((name: string) => boolean) | null = null;
    private modulePrioritySetter: ((name: string, priority: number) => boolean) | null = null;
    private modulePriorityGetter: ((name: string) => number) | null = null;
    private modulesGetter: (() => string[]) | null = null;
    private moduleInfoGetter: ((name: string) => Record<string, unknown> | null) | null = null;
    private cssRewriter: ((css: string) => string) | null = null;
    private scriptToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private triggerToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private timerToggler: ((name: string, enabled: boolean) => boolean) | null = null;
    private existsCallback: ((name: string, type: string) => number) | null = null;
    // Mudlet returns a numeric script id from permScript/permRegexTrigger/setScript;
    // -1 signals failure (missing parent group, unknown script name, etc.).
    private permScriptCallback: ((name: string, parent: string, code: string) => number) | null = null;
    private permRegexTriggerCallback: ((name: string, parent: string, regexes: string[], code: string) => number) | null = null;
    private setScriptCallback: ((name: string, code: string, pos: number) => number) | null = null;
    // Mudlet's killTimer/killAlias/killTrigger/killKey accept the name of a
    // permanent item in addition to the numeric id of a temp one. The engine
    // wires these to remove the matching store nodes.
    private killByNameCallback: ((kind: 'timer' | 'alias' | 'trigger' | 'key', name: string) => boolean) | null = null;

    private selection: { windowName: string | undefined; start: number; length: number } | null = null;

    constructor(
        private readonly session: MudSession,
        aliasEngine: AliasEngine,
        triggerEngine: TriggerEngine,
        timerEngine: TimerEngine,
        keyEngine: KeyEngine,
    ) {
        this.windows = new ScriptingWindowsAPI(session);
        this.labels = new ScriptingLabelsAPI(session.labels, () => this.cssRewriter);
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

    sendGmcp(message: string): void {
        this.session.sendGmcpRaw(message);
    }

    setSendRequestDispatcher(fn: ((text: string) => boolean) | null): void {
        this.sendRequestDispatcher = fn;
    }

    setFeedDispatcher(fn: ((groups: { text: string; type: string }[]) => void) | null): void {
        this.feedDispatcher = fn;
    }

    setPackageInstaller(fn: ((path: string) => boolean) | null): void {
        this.packageInstaller = fn;
    }

    setPackageUninstaller(fn: ((name: string) => boolean) | null): void {
        this.packageUninstaller = fn;
    }

    setPackagesGetter(fn: (() => string[]) | null): void {
        this.packagesGetter = fn;
    }

    getPackages(): string[] {
        return this.packagesGetter?.() ?? [];
    }

    setModuleInstaller(fn: ((path: string) => boolean) | null): void { this.moduleInstaller = fn; }
    setModuleUninstaller(fn: ((name: string) => boolean) | null): void { this.moduleUninstaller = fn; }
    setModuleSyncer(fn: ((name: string) => Promise<void>) | null): void { this.moduleSyncer = fn; }
    setModuleReloader(fn: ((name: string) => boolean) | null): void { this.moduleReloader = fn; }
    setModuleSyncSetter(fn: ((name: string, sync: boolean) => void) | null): void { this.moduleSyncSetter = fn; }
    setModuleSyncGetter(fn: ((name: string) => boolean) | null): void { this.moduleSyncGetter = fn; }
    setModulePrioritySetter(fn: ((name: string, priority: number) => boolean) | null): void { this.modulePrioritySetter = fn; }
    setModulePriorityGetter(fn: ((name: string) => number) | null): void { this.modulePriorityGetter = fn; }
    setModulesGetter(fn: (() => string[]) | null): void { this.modulesGetter = fn; }
    setModuleInfoGetter(fn: ((name: string) => Record<string, unknown> | null) | null): void { this.moduleInfoGetter = fn; }

    installModule(path: string): boolean { return this.moduleInstaller?.(path) ?? false; }
    uninstallModule(name: string): boolean { return this.moduleUninstaller?.(name) ?? false; }
    syncModule(name: string): Promise<void> { return this.moduleSyncer?.(name) ?? Promise.resolve(); }
    reloadModule(name: string): boolean { return this.moduleReloader?.(name) ?? false; }
    enableModuleSync(name: string): void { this.moduleSyncSetter?.(name, true); }
    disableModuleSync(name: string): void { this.moduleSyncSetter?.(name, false); }
    getModuleSync(name: string): boolean { return this.moduleSyncGetter?.(name) ?? false; }
    setModulePriority(name: string, priority: number): boolean {
        return this.modulePrioritySetter?.(name, priority) ?? false;
    }
    getModulePriority(name: string): number { return this.modulePriorityGetter?.(name) ?? 0; }
    getModules(): string[] { return this.modulesGetter?.() ?? []; }
    getModuleInfo(name: string): Record<string, unknown> | null { return this.moduleInfoGetter?.(name) ?? null; }

    setScriptToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.scriptToggler = fn;
    }

    setTriggerToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.triggerToggler = fn;
    }

    setTimerToggler(fn: ((name: string, enabled: boolean) => boolean) | null): void {
        this.timerToggler = fn;
    }

    setExistsCallback(fn: ((name: string, type: string) => number) | null): void {
        this.existsCallback = fn;
    }

    setPermScriptCallback(fn: ((name: string, parent: string, code: string) => number) | null): void {
        this.permScriptCallback = fn;
    }

    setPermRegexTriggerCallback(fn: ((name: string, parent: string, regexes: string[], code: string) => number) | null): void {
        this.permRegexTriggerCallback = fn;
    }

    setSetScriptCallback(fn: ((name: string, code: string, pos: number) => number) | null): void {
        this.setScriptCallback = fn;
    }

    setKillByNameCallback(fn: ((kind: 'timer' | 'alias' | 'trigger' | 'key', name: string) => boolean) | null): void {
        this.killByNameCallback = fn;
    }

    killByName(kind: 'timer' | 'alias' | 'trigger' | 'key', name: string): boolean {
        return this.killByNameCallback?.(kind, name) ?? false;
    }

    setCssRewriter(fn: ((css: string) => string) | null): void {
        this.cssRewriter = fn;
    }

    installPackage(path: string): boolean {
        return this.packageInstaller?.(path) ?? false;
    }

    uninstallPackage(name: string): boolean {
        return this.packageUninstaller?.(name) ?? false;
    }

    enableScript(name: string): boolean {
        return this.scriptToggler?.(name, true) ?? false;
    }

    disableScript(name: string): boolean {
        return this.scriptToggler?.(name, false) ?? false;
    }

    enableTrigger(name: string): boolean {
        return this.triggerToggler?.(name, true) ?? false;
    }

    disableTrigger(name: string): boolean {
        return this.triggerToggler?.(name, false) ?? false;
    }

    enableTimer(name: string): boolean {
        return this.timerToggler?.(name, true) ?? false;
    }

    disableTimer(name: string): boolean {
        return this.timerToggler?.(name, false) ?? false;
    }

    exists(name: string, type: string): number {
        return this.existsCallback?.(name, type) ?? 0;
    }

    permScript(name: string, parent: string, code: string): number {
        return this.permScriptCallback?.(name, parent, code) ?? -1;
    }

    permRegexTrigger(name: string, parent: string, regexes: string[], code: string): number {
        return this.permRegexTriggerCallback?.(name, parent, regexes, code) ?? -1;
    }

    setScript(name: string, code: string, pos: number): number {
        return this.setScriptCallback?.(name, code, pos) ?? -1;
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
        const line = (this.lineBuffer && isMain && this.cursorOnLineBuffer)
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

    /**
     * Mudlet `selectSection([window,] from, length) → bool`. `from` is 0-indexed.
     * Negative `from` is rejected (Mudlet behavior); zero/negative lengths
     * register a no-op selection but still report success in Mudlet — we match
     * that, but reject when the resolved buffer doesn't exist.
     */
    selectSection(from: number, length: number, windowName?: string): boolean {
        if (!Number.isFinite(from) || from < 0) return false;
        if (!Number.isFinite(length) || length < 0) return false;
        const buf = this.resolveBuffer(windowName);
        if (!buf) return false;
        this.selection = { windowName, start: from, length };
        return true;
    }

    deselect(): void {
        this.selection = null;
    }

    /**
     * Mudlet `getSelection([windowName])`. Returns the currently selected text
     * along with its 0-based start column and length on the active line. Returns
     * null when no selection is set, or when `windowName` is given and doesn't
     * match the selection's window — the Lua wrapper translates null into
     * Mudlet's `false, "no selection"` 2-tuple.
     */
    getSelection(windowName?: string): { text: string; start: number; length: number } | null {
        if (!this.selection) return null;
        if (windowName !== undefined && !this.selectionMatches(windowName)) return null;
        const buf = this.resolveBuffer(this.selection.windowName);
        if (!buf) return null;
        const { start, length } = this.selection;
        return { text: buf.text.slice(start, start + length), start, length };
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
        this.cursorCol = 0;
        // Mudlet's cursor sits on the matching line at trigger fire time.
        // Mudix doesn't have it in history yet, so we expose the lineBuffer
        // as a virtual line one past the last rendered line.
        this.lineBufferLineIndex = this.mainConsole.getLineCount() + 1;
        this.cursorOnLineBuffer = true;
        this.isDeferringEcho = true;
    }

    /**
     * Called after all triggers for a line have run (but before render).
     * Clears the pre-render buffer reference; echo deferral stays active until
     * flushDeferredEcho() is called.
     */
    clearLineBuffer(): void {
        this.lineBuffer = null;
        this.lineBufferLineIndex = null;
        this.cursorOnLineBuffer = false;
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
        if (this.lineBuffer && isMain && this.cursorOnLineBuffer) return this.lineBuffer.text;
        return this.getConsole(windowName)?.getLine() ?? '';
    }

    // Mudlet line-index APIs are 0-indexed: getLineNumber() == cursor.y(),
    // getLineCount()/getLastLineNumber() == size - 1. Missing windows report
    // -1 (Mudlet's "no such window" sentinel). Inside a trigger on main, the
    // matching line is virtual (one past the last rendered line) — getLine*
    // APIs report it as a real line so script logic like
    // `moveCursor(x, getLineNumber())` lands back on the lineBuffer.
    getLineNumber(windowName?: string): number {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain && this.lineBufferLineIndex != null) {
            return this.lineBufferLineIndex;
        }
        return this.getConsole(windowName)?.getLineNumber() ?? -1;
    }

    getLineCount(windowName?: string): number {
        const isMain = !windowName || windowName === 'main';
        const con = this.getConsole(windowName);
        if (!con) return -1;
        if (this.lineBuffer && isMain && this.lineBufferLineIndex != null) {
            return this.lineBufferLineIndex;
        }
        return con.getLineCount();
    }

    getLastLineNumber(windowName?: string): number {
        return this.getLineCount(windowName);
    }

    getLines(from: number, to: number, windowName?: string): string[] {
        return this.getConsole(windowName)?.getLines(from, to) ?? [];
    }

    getColumnNumber(windowName?: string): number {
        // Mudlet returns the user cursor column (mUserCursor.x()), independent
        // of the active selection. While the cursor is on the trigger's
        // matching line, return the live lineBuffer column so xEcho's
        // "advance by segment length" loop in cinsertText threads forward
        // correctly. Otherwise (no trigger, or moveCursor moved off the
        // matching line) return the persistent column on the rendered Console.
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain && this.cursorOnLineBuffer) return this.cursorCol;
        return this.getConsole(windowName)?.getCursorColumn() ?? 0;
    }

    /**
     * Mudlet getColumnCount. Returns the wrap width (in characters) configured
     * via setWindowWrap; if none is set, measures the rendered output element
     * and returns how many monospace characters fit horizontally. Returns 0
     * when the window doesn't exist or hasn't been mounted yet.
     */
    getColumnCount(windowName?: string): number {
        const isMain = !windowName || windowName === 'main';
        const wrap = isMain
            ? useAppStore.getState().ui.outputWrapAt
            : this.session.windows.getWrap(windowName!);
        if (wrap && wrap > 0) return wrap;

        const el = isMain
            ? this.session.windows.getElement('main')
            : this.session.windows.getElement(windowName!);
        return measureColumnCapacity(el);
    }

    /**
     * Mudlet setWindowWrap(name, charsPerLine). Sets the visual wrap width
     * (in monospace columns) for the named window or "main". 0 clears the
     * setting. Returns false when the named window does not exist; main always
     * succeeds (persisted via ui.outputWrapAt).
     */
    setWindowWrap(name: string, wrapAt: number): boolean {
        if (!Number.isFinite(wrapAt)) return false;
        const v = Math.max(0, Math.round(wrapAt));
        if (!name || name === 'main') {
            useAppStore.getState().patchUI({ outputWrapAt: v > 0 ? v : undefined });
            return true;
        }
        return this.session.windows.setWrap(name, v);
    }

    /**
     * Mudlet `insertText([window,] text)`. During trigger processing for the
     * main window, inserts at the column cursor inside the active lineBuffer
     * (this is the path Mudlet's `prefix()` and `creplace()` rely on — they
     * route through `cinsertText` → `xEcho` → `insertText(win, seg)` per
     * segment). Outside that context we don't have a real column cursor, so
     * the call degrades to an echo at end-of-buffer — same as before.
     */
    insertText(text: string, windowName?: string): void {
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain && this.cursorOnLineBuffer) {
            const state = this.mainConsole.format.toSnapshot();
            const at = Math.max(0, Math.min(this.cursorCol, this.lineBuffer.text.length));
            this.lineBuffer.insert(at, text, state);
            return;
        }
        if (isMain) {
            this.mainConsole.echo(text);
            this.drainMain();
        } else {
            this.echoToWindow(windowName!, text);
        }
    }

    /**
     * Mudlet `moveCursorUp([window,] [lines=1,] [keepHorizontal=false]) → bool`.
     * `keepHorizontal=true` preserves the column across the vertical move; the
     * default (false) resets the column to 0, matching Mudlet semantics.
     * Vertical moves always move the cursor onto rendered history — even from
     * the in-flight matching line — so the lineBuffer "follow" mode is
     * released.
     */
    moveCursorUp(windowName?: string, lines: number = 1, keepHorizontal: boolean = false): boolean {
        const ok = this.getConsole(windowName)?.moveUp(lines, keepHorizontal) ?? false;
        const isMain = !windowName || windowName === 'main';
        if (ok && isMain) this.cursorOnLineBuffer = false;
        return ok;
    }

    moveCursorDown(windowName?: string, lines: number = 1, keepHorizontal: boolean = false): boolean {
        const ok = this.getConsole(windowName)?.moveDown(lines, keepHorizontal) ?? false;
        const isMain = !windowName || windowName === 'main';
        if (ok && isMain) this.cursorOnLineBuffer = false;
        return ok;
    }

    /**
     * Mudlet `moveCursor([window,] x, y) → bool`. The cursor moves freely on
     * either rendered history or the in-flight matching line — there is no
     * special "trigger mode" in Mudlet. When `y` matches the lineBuffer's
     * virtual line index, x is recorded as the trigger-line column and the
     * cursor stays "on" the matching line so subsequent insertText/replace/
     * getCurrentLine target it. Otherwise the cursor is seeked on the rendered
     * Console. Returns true on a successful move.
     */
    moveCursor(windowName: string | undefined, x: number, y: number): boolean {
        if (!Number.isFinite(x) || x < 0) return false;
        if (!Number.isFinite(y) || y < 0) return false;
        const isMain = !windowName || windowName === 'main';
        if (this.lineBuffer && isMain && y === this.lineBufferLineIndex) {
            this.cursorCol = Math.min(Math.trunc(x), this.lineBuffer.text.length);
            this.cursorOnLineBuffer = true;
            return true;
        }
        const con = this.getConsole(windowName);
        if (!con) return false;
        const ok = con.moveTo(y, x);
        if (ok && isMain) this.cursorOnLineBuffer = false;
        return ok;
    }

    moveCursorEnd(windowName?: string): void {
        const isMain = !windowName || windowName === 'main';
        // Inside a trigger on main, the lineBuffer is the conceptual "last
        // line" — position the cursor at its end and stay in lineBuffer mode.
        if (this.lineBuffer && isMain) {
            this.cursorCol = this.lineBuffer.text.length;
            this.cursorOnLineBuffer = true;
            this.mainConsole.markCursorAtEnd();
            return;
        }
        const con = this.getConsole(windowName);
        if (!con) return;
        const lastLine = con.getLineCount();
        con.moveTo(lastLine);
        con.setCursorColumn(con.getLine().length);
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
        if (this.lineBuffer && isMain && this.cursorOnLineBuffer) {
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

    clearCmdLine(): void {
        this.session.events.emit('script.clearcmd');
    }

    centerView(roomId: number): void {
        this.session.windows.centerView(roomId);
    }

    getRoomIDbyHash(hash: string): number | undefined {
        return this.session.windows.getRoomIDbyHash(hash);
    }

    // ── Map scripting API ─────────────────────────────────────────────────────

    get map() { return this.session.windows.mapStore; }

    get cmdLineMenu() { return this.session.cmdLineMenu; }

    /**
     * Mudlet `loadMap([location])`. Persists the bytes (when given) to the
     * connection's binary-map IndexedDB slot and re-renders any open MapPanel.
     * The Lua binding in LuaRuntime reads the VFS path before calling here so
     * this method only deals in already-decoded bytes. Returns true unless the
     * panel reported a parse failure for the given buffer.
     */
    loadMap(buf?: Uint8Array): boolean {
        if (!buf) return this.session.windows.loadMap();
        // Copy into a fresh standalone ArrayBuffer — the source may be a slice
        // of a larger buffer (e.g. a Node Buffer view onto a pool) or a
        // SharedArrayBuffer-backed view, both of which the binary reader chokes on.
        const out = new ArrayBuffer(buf.byteLength);
        new Uint8Array(out).set(buf);
        return this.session.windows.loadMap(out);
    }

    // ── Misc ──────────────────────────────────────────────────────────────────

    getNetworkLatency(): number {
        return this.session.ping ?? 0;
    }

    getMainWindowSize(): [number, number] {
        // Reports the full viewport (the coordinate space labels live in), not
        // the console area. Borders carve insets out of this rectangle without
        // shrinking it — matches Mudlet so scripts that place labels with
        // `y = h - labelHeight` after setBorderBottom land in the carved zone.
        const el = this.session.windows.getMainViewportElement()
                ?? this.session.windows.getElement('main');
        if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) return [rect.width, rect.height];
        }
        return [window.innerWidth, window.innerHeight];
    }

    /**
     * Mudlet getUserWindowSize(name). Returns the rendered [width, height] of a
     * userwindow / miniconsole in pixels. Reports the live element box when the
     * panel is mounted (so docked panels reflect their actual on-screen size),
     * otherwise falls back to the stored window hint. Returns [0, 0] when the
     * window doesn't exist.
     */
    getUserWindowSize(name: string): [number, number] {
        const size = name ? this.session.windows.getSize(name) : null;
        if (!size) return [0, 0];
        return [size.width, size.height];
    }

    /**
     * Mudlet setFontSize. Without `win` (or "main"), persists ui.fontSize so the
     * main output picks it up. With a window name, sets the per-window output
     * font size on WindowManager (saved into the window's hint).
     */
    setFontSize(size: number, win?: string): boolean {
        if (!Number.isFinite(size) || size < 1 || size > 99) return false;
        const rounded = Math.round(size);
        if (!win || win === 'main') {
            useAppStore.getState().patchUI({ fontSize: rounded });
            return true;
        }
        return this.session.windows.setFontSize(win, rounded);
    }

    /**
     * Mudlet getFontSize. Returns the configured font size in pixels for the
     * main window (when no name passed) or for a specific window. Returns null
     * if a named window doesn't exist or has no override.
     */
    getFontSize(win?: string): number | null {
        if (!win || win === 'main') return useAppStore.getState().ui.fontSize;
        if (!this.session.windows.has(win)) return null;
        return this.session.windows.getFontSize(win) ?? useAppStore.getState().ui.fontSize;
    }

    /**
     * Mudlet setBackgroundColor. With no name (or "main") sets the main window
     * background; otherwise dispatches to the matching label or userwindow/
     * miniconsole. Channels are 0..255; alpha defaults to 255.
     */
    setBackgroundColor(name: string | undefined, r: number, g: number, b: number, a = 255): boolean {
        if (!name || name === 'main') {
            useAppStore.getState().patchUI({ outputBackgroundColor: { r, g, b, a } });
            return true;
        }
        if (this.session.labels.has(name)) {
            return this.session.labels.setBackgroundColor(name, r, g, b, a);
        }
        return this.session.windows.setBackgroundColor(name, r, g, b, a);
    }

    /**
     * Mudlet getBackgroundColor. Without a name (or "main") returns the main
     * window background; otherwise looks up the named window/miniconsole. Labels
     * fall through here too — their fill color is reported. Returns null when
     * the name doesn't resolve to anything; callers (Lua wrapper) translate that
     * to a 4-tuple of zeros.
     */
    getBackgroundColor(name?: string): { r: number; g: number; b: number; a: number } | null {
        if (!name || name === 'main') {
            return useAppStore.getState().ui.outputBackgroundColor ?? null;
        }
        if (this.session.labels.has(name)) {
            return this.session.labels.getBackgroundColor(name);
        }
        return this.session.windows.getBackgroundColor(name);
    }

    // ── Borders ───────────────────────────────────────────────────────────────
    // Mudlet setBorderTop/Bottom/Left/Right carve pixel insets out of the main
    // window so labels can sit in the freed space. Sizes are clamped to >= 0
    // and rounded; non-finite input is rejected. Reads/writes ui.outputBorders.

    setBorderTop(size: number): void { this.patchBorders('top', size); }
    setBorderBottom(size: number): void { this.patchBorders('bottom', size); }
    setBorderLeft(size: number): void { this.patchBorders('left', size); }
    setBorderRight(size: number): void { this.patchBorders('right', size); }

    /**
     * Mudlet setBorderSizes — CSS-shorthand-style overloads:
     *   1 arg  → uniform                 (all = a)
     *   2 args → (vertical, horizontal)  (top=bottom=a, left=right=b)
     *   3 args → (top, horizontal, bot)  (left=right=b)
     *   4 args → CSS top/right/bottom/left
     * Other arities no-op (matches Mudlet's silent reject).
     */
    setBorderSizes(a?: number, b?: number, c?: number, d?: number): void {
        const A = this.normalizeBorder(a);
        const B = this.normalizeBorder(b);
        const C = this.normalizeBorder(c);
        const D = this.normalizeBorder(d);
        let t: number | null | undefined, r: number | null | undefined,
            bo: number | null | undefined, l: number | null | undefined;
        if (b === undefined && c === undefined && d === undefined) {
            t = r = bo = l = A;
        } else if (c === undefined && d === undefined) {
            t = bo = A; r = l = B;
        } else if (d === undefined) {
            t = A; r = l = B; bo = C;
        } else {
            t = A; r = B; bo = C; l = D;
        }
        if (t == null || r == null || bo == null || l == null) return;
        useAppStore.getState().patchUI({ outputBorders: { top: t, right: r, bottom: bo, left: l } });
    }

    getBorderTop(): number { return useAppStore.getState().ui.outputBorders?.top ?? 0; }
    getBorderBottom(): number { return useAppStore.getState().ui.outputBorders?.bottom ?? 0; }
    getBorderLeft(): number { return useAppStore.getState().ui.outputBorders?.left ?? 0; }
    getBorderRight(): number { return useAppStore.getState().ui.outputBorders?.right ?? 0; }

    getBorderSizes(): { top: number; right: number; bottom: number; left: number } {
        return useAppStore.getState().ui.outputBorders ?? { top: 0, right: 0, bottom: 0, left: 0 };
    }

    /** Mudlet setBorderColor. Channels are 0..255; alpha defaults to 255. */
    setBorderColor(r: number, g: number, b: number, a = 255): void {
        useAppStore.getState().patchUI({ outputBorderColor: { r, g, b, a } });
    }

    /** Mudlet resetBorderColor — clears the override so the border tracks the page background again. */
    resetBorderColor(): void {
        useAppStore.getState().patchUI({ outputBorderColor: undefined });
    }

    private patchBorders(side: 'top' | 'right' | 'bottom' | 'left', size: number): void {
        const v = this.normalizeBorder(size);
        if (v == null) return;
        const cur = useAppStore.getState().ui.outputBorders ?? { top: 0, right: 0, bottom: 0, left: 0 };
        useAppStore.getState().patchUI({ outputBorders: { ...cur, [side]: v } });
    }

    private normalizeBorder(n: unknown): number | null {
        const num = Number(n);
        if (!Number.isFinite(num)) return null;
        return Math.max(0, Math.round(num));
    }

    /**
     * Mudlet setFont. Without `win` (or "main"), updates ui.outputFont so the
     * App-level applyOutputFont effect re-applies the --font-output CSS variable.
     * With a window name, sets the per-window override on WindowManager.
     * Empty `family` clears the override (main → unset, window → inherit).
     */
    setFont(family: string, win?: string): boolean {
        const fam = (family ?? '').trim();
        if (!win || win === 'main') {
            const next = fam ? { kind: 'system' as const, family: fam } : undefined;
            useAppStore.getState().patchUI({ outputFont: next });
            return true;
        }
        return this.session.windows.setFont(win, fam);
    }

    /**
     * Mudlet getFont. Returns the configured font family for the main window
     * (or empty string if none set) or for a specific window. Returns null if
     * the named window doesn't exist.
     */
    getFont(win?: string): string | null {
        if (!win || win === 'main') {
            return useAppStore.getState().ui.outputFont?.family ?? '';
        }
        if (!this.session.windows.has(win)) return null;
        const own = this.session.windows.getFont(win);
        if (own != null) return own;
        return useAppStore.getState().ui.outputFont?.family ?? '';
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
        if (this.lineBuffer && isMain && this.cursorOnLineBuffer) return this.lineBuffer;
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
