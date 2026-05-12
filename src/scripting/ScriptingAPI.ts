import type { MudSession, ScriptLogSource } from '../mud/MudSession';
import type { AliasEngine } from '../mud/aliases/AliasEngine';
import type { TriggerEngine } from '../mud/triggers/TriggerEngine';
import type { TimerEngine } from '../mud/timers/TimerEngine';
import type { KeyEngine } from '../mud/keybindings/KeyEngine';
import type { WindowHandle, WindowOpenOptions } from '../ui/windows/types';
import type { LabelManager, LabelCreateOptions, LabelMouseEvent, LabelWheelEvent } from '../ui/labels/LabelManager';
import { userWindowQssToScopedCss, cssEscape } from '../ui/labels/qtCss';
import { AnsiAwareBuffer, type FormatStateSnapshot, type FormatHyperlink, type RgbColor } from '../mud/text/FormatState';
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

    setTitle(id: string, title?: string): boolean {
        return this.session.windows.setTitle(id, title);
    }

    focus(id: string): void {
        this.session.windows.focus(id);
    }

    hide(id: string): void {
        this.session.windows.hide(id);
    }

    show(id: string): boolean {
        return this.session.windows.show(id);
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

    bringToFront(id: string): void {
        this.session.windows.bringToFront(id);
    }

    sendToBack(id: string): void {
        this.session.windows.sendToBack(id);
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
    setClickCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setClickCallback(name, fn);
    }
    setMouseUpCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseUpCallback(name, fn);
    }
    setDoubleClickCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setDoubleClickCallback(name, fn);
    }
    setMouseMoveCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseMoveCallback(name, fn);
    }
    setMouseEnterCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseEnterCallback(name, fn);
    }
    setMouseLeaveCallback(name: string, fn: ((e: LabelMouseEvent) => void) | undefined): boolean {
        return this.manager.setMouseLeaveCallback(name, fn);
    }
    setWheelCallback(name: string, fn: ((e: LabelWheelEvent) => void) | undefined): boolean {
        return this.manager.setWheelCallback(name, fn);
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
    profileName = '';
    readonly timers: TimerEngine;
    readonly keys: KeyEngine;

    private readonly mainConsole = new Console();

    // True while the trigger pipeline is running for the current line. Drives
    // echo deferral and rerender suppression — Mudlet's TLuaInterpreter has no
    // analogous flag (the renderer reads the buffer at paint time), but mudix
    // renders via 'message' events, so we have to suppress per-mutation
    // rerenders during trigger processing and let the post-trigger render
    // pick up the final state in one shot.
    private inTriggerProcessing = false;

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
    private existsCallback: ((nameOrId: string | number, type: string) => number) | null = null;
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

    setExistsCallback(fn: ((nameOrId: string | number, type: string) => number) | null): void {
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
        console.debug(`Enabling trigger: ${name}`);
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

    exists(nameOrId: string | number, type: string): number {
        return this.existsCallback?.(nameOrId, type) ?? 0;
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

    /**
     * Mudlet `echoLink([win,] text, cmd, hint, [useCurrentFormat])`. With
     * `useCurrentFormat=false` (the default), the link is rendered with
     * Mudlet's built-in style: blue foreground + underline. With
     * `useCurrentFormat=true`, the current pen state on the resolved console
     * is preserved.
     */
    echoLink(text: string, cmd: string, tooltip: string, win?: string, useCurrentFormat = false): void {
        if (!text) return;  // xEcho emits empty-text calls for colour-only segments
        const hyperlink: FormatHyperlink = {
            onClick: () => { this.executeScript?.(cmd); },
            title: tooltip || undefined,
        };
        const con = this.outputConsole(win);
        con.format.hyperlink = hyperlink;
        if (!useCurrentFormat) {
            // Mudlet's TConsole::echoLink default: blue + underline.
            const prevFg = con.format.foreground;
            const prevUnderline = con.format.underline;
            con.format.foreground = { space: 'rgb', r: 0, g: 0, b: 255 };
            con.format.underline = true;
            con.echo(text);
            con.format.foreground = prevFg;
            con.format.underline = prevUnderline;
        } else {
            con.echo(text);
        }
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

    setBgColor(r: number, g: number, b: number, a?: number, win?: string): void {
        const color: RgbColor = a !== undefined && a < 255
            ? { space: 'rgb', r, g, b, a }
            : { space: 'rgb', r, g, b };
        if (this.selectionMatches(win)) {
            this.applyStateToSelection({ background: color });
        }
        this.outputConsole(win).setBgColor(r, g, b, a);
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
        this.setBgColor(c.r, c.g, c.b, undefined, win);
    }

    resetFormat(windowName?: string): void {
        if (this.selection) {
            const sel = this.selection;
            this.selection = null;
            const buf = this.resolveBuffer(sel.windowName);
            if (buf) {
                buf.clearFormat([sel.start, sel.start + sel.length]);
                if (!this.inTriggerProcessing) buf.rerender();
            }
            return;
        }
        this.outputConsole(windowName).resetFormat();
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    selectString(str: string, occurrence: number, windowName?: string): number {
        // Mudlet searches the cursor's current line. With Console as the
        // canonical buffer that is just `Console.getLine()` — including the
        // matching line during trigger processing (just appended) and any
        // history line the cursor was moved to.
        const line = this.getConsole(windowName)?.getLine() ?? '';

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

    /**
     * Mudlet `selectCurrentLine([window])`. Selects the entire cursor line —
     * equivalent to `selectSection(0, #getCurrentLine())`. Returns false when
     * the named window doesn't exist; true otherwise (the main window always
     * exists, even with no history yet).
     */
    selectCurrentLine(windowName?: string): boolean {
        if (windowName && windowName !== 'main' && !this.session.windows.has(windowName)) {
            return false;
        }
        const line = this.getConsole(windowName)?.getLine() ?? '';
        this.selection = { windowName, start: 0, length: line.length };
        return true;
    }

    /**
     * Mudlet `deselect([windowName])`. With a window name, only clears the
     * selection if it belongs to that window — selections in other consoles
     * remain intact. Without an arg, clears unconditionally.
     */
    deselect(windowName?: string): void {
        if (windowName !== undefined && !this.selectionMatches(windowName)) return;
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

    /**
     * Mudlet `setLink([windowName], command, hint)`. Applies a clickable
     * hyperlink to the current selection — preserves existing colors/attributes
     * on each segment (unlike setFgColor & friends which homogenize). `command`
     * is the Lua code run on click; the Bridge.lua wrapper converts function
     * arguments into a `__mudix_call_link(id)` string before reaching here.
     * Returns false if there is no selection (or it doesn't belong to `win`).
     */
    setLink(cmd: string, tooltip: string, win?: string): boolean {
        if (!this.selection) return false;
        if (win !== undefined && !this.selectionMatches(win)) return false;
        const sel = this.selection;
        const buf = this.resolveBuffer(sel.windowName);
        if (!buf) return false;
        const hyperlink: FormatHyperlink = {
            onClick: () => { this.executeScript?.(cmd); },
            title: tooltip || undefined,
        };
        buf.setHyperlink([sel.start, sel.start + sel.length], hyperlink);
        if (!this.inTriggerProcessing) buf.rerender();
        return true;
    }

    // ── Trigger pipeline hooks (called by ScriptingEngine) ────────────────────

    /**
     * Called before trigger processing for each incoming line. Pushes the
     * matching line into mainConsole.history so cursor-driven APIs see it as
     * a regular addressable line (Mudlet's TBuffer holds the matching line
     * during trigger processing — the cursor is just an (x,y) into that
     * single buffer). The cursor is automatically positioned on the new line
     * at column 0 by Console.appendLine. Also enables echo deferral so
     * trigger-emitted echoes appear after the rendered line.
     */
    beginLine(buffer: AnsiAwareBuffer, isPrompt = false): void {
        buffer.isPrompt = isPrompt;
        this.mainConsole.appendLine(buffer);
        this.inTriggerProcessing = true;
        this.selection = null;
        this.isDeferringEcho = true;
    }

    /**
     * Called after all triggers for a line have run (but before render).
     * Drops the trigger-active flag; echo deferral stays on until
     * flushDeferredEcho() is called.
     */
    endLine(): void {
        this.inTriggerProcessing = false;
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

    /**
     * Mudlet `getCurrentLine([window])`. Returns the text on the cursor's
     * current line, or `null` when the named window doesn't exist — the Lua
     * binding turns that into Mudlet's `(nil, errMsg)` 2-tuple. Falls back to
     * an empty string for the main window (always present, may have no line yet).
     */
    getCurrentLine(windowName?: string): string | null {
        if (windowName && windowName !== 'main' && !this.session.windows.has(windowName)) {
            return null;
        }
        return this.getConsole(windowName)?.getLine() ?? '';
    }

    // Mudlet line-index APIs are 0-indexed: getLineNumber() == cursor.y(),
    // getLineCount()/getLastLineNumber() == size - 1. Missing windows report
    // -1 (Mudlet's "no such window" sentinel). With Console as the canonical
    // buffer (network lines are pushed via beginLine before triggers fire),
    // these read directly off Console — no special trigger branch needed.
    getLineNumber(windowName?: string): number {
        return this.getConsole(windowName)?.getLineNumber() ?? -1;
    }

    getLineCount(windowName?: string): number {
        return this.getConsole(windowName)?.getLineCount() ?? -1;
    }

    getLastLineNumber(windowName?: string): number {
        return this.getConsole(windowName)?.getLineCount() ?? -1;
    }

    getLines(from: number, to: number, windowName?: string): string[] {
        return this.getConsole(windowName)?.getLines(from, to) ?? [];
    }

    getColumnNumber(windowName?: string): number {
        // Mudlet's mUserCursor.x() — just the cursor's column on the cursor's
        // current line. Console owns the persistent column cursor for both
        // history and the in-flight matching line.
        return this.getConsole(windowName)?.getCursorColumn() ?? 0;
    }

    /** Mudlet `isPrompt()` — reports the per-line prompt flag at the current
     *  cursor position. Lines pushed via beginLine carry the flag, so
     *  moveCursor + isPrompt can inspect historical lines, not just the most
     *  recent one. Defaults to false for the main window when no history exists. */
    isPrompt(windowName?: string): boolean {
        return this.getConsole(windowName)?.cursorOnPrompt() ?? false;
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
     * Mudlet `insertText([window,] text)`. Inserts `text` at the cursor on
     * the cursor's current line — works the same way during trigger processing
     * (cursor is on the just-appended matching line) and outside (cursor is
     * wherever moveCursor put it). Falls back to an end-of-buffer echo only
     * when the cursor isn't on a valid line yet (empty buffer / sub-window
     * without a backing buffer).
     */
    insertText(text: string, windowName?: string): void {
        const isMain = !windowName || windowName === 'main';
        const con = this.getConsole(windowName);
        const buf = con?.getBuffer();
        if (con && buf) {
            const state = con.format.toSnapshot();
            const at = Math.max(0, Math.min(con.getCursorColumn(), buf.text.length));
            buf.insert(at, text, state);
            if (!this.inTriggerProcessing) buf.rerender();
            return;
        }
        // No current line: degrade to an echo so the text isn't lost.
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
     * default (false) resets the column to 0.
     */
    moveCursorUp(windowName?: string, lines: number = 1, keepHorizontal: boolean = false): boolean {
        return this.getConsole(windowName)?.moveUp(lines, keepHorizontal) ?? false;
    }

    moveCursorDown(windowName?: string, lines: number = 1, keepHorizontal: boolean = false): boolean {
        return this.getConsole(windowName)?.moveDown(lines, keepHorizontal) ?? false;
    }

    /**
     * Mudlet `moveCursor([window,] x, y) → bool`. The cursor is just an (x,y)
     * into the central buffer — works the same way during trigger processing
     * and outside, because the matching line is pushed into Console.history
     * before triggers fire (Mudlet has the same model: matching line is the
     * last line in TBuffer; cursor.y is its index). Returns true on a
     * successful move.
     */
    moveCursor(windowName: string | undefined, x: number, y: number): boolean {
        if (!Number.isFinite(x) || x < 0) return false;
        if (!Number.isFinite(y) || y < 0) return false;
        return this.getConsole(windowName)?.moveTo(y, x) ?? false;
    }

    moveCursorEnd(windowName?: string): void {
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
     * a positioned text panel inside the given parent (defaults to `main`), or
     * repositions it if it already exists (Mudlet 3.0+ semantics). When parent
     * is a userwindow, the miniconsole renders inside that parent's viewport
     * at parent-relative coordinates and follows parent moves/resizes.
     * Returns true on success.
     */
    createMiniConsole(name: string, x: number, y: number, width: number, height: number, parent?: string): boolean {
        if (!name) return false;
        const wm = this.session.windows;
        if (!wm.has(name)) {
            wm.open(name, {
                kind: 'text',
                title: name,
                autoDock: false,
                ignoreHint: true,
                parent: parent && parent !== 'main' ? parent : undefined,
            });
        } else {
            wm.show(name);
        }
        wm.markAsMiniConsole(name);
        wm.setPosition(name, Math.round(x), Math.round(y));
        wm.setSize(name, Math.round(width), Math.round(height));
        return true;
    }

    /**
     * Mudlet `replace([win,] with, [keepcolor])`. Default (`keepcolor=false`)
     * applies the resolved console's current pen state (set via
     * setFgColor/setBgColor/etc.) to the replacement text. With
     * `keepcolor=true`, the replacement inherits the selection's existing
     * format — same as our previous behavior.
     */
    replace(newText: string, windowName?: string, keepColor = false): void {
        if (!this.selection) return;
        const sel = this.selection;
        const targetWin = windowName ?? sel.windowName;
        const buf = this.resolveBuffer(targetWin);
        if (!buf) return;
        const state = keepColor ? undefined : this.outputConsole(targetWin).format.toSnapshot();
        buf.replace([sel.start, sel.start + sel.length], newText, state);
        this.selection = null;
        if (!this.inTriggerProcessing) buf.rerender();
    }

    /**
     * Mudlet `deleteLine([window])`. Marks the cursor's current buffer as
     * deleted. When that buffer is the matching line of an in-flight trigger,
     * the renderer skips emitting it; when it's a rendered history line,
     * Console.deleteLine removes it from the DOM.
     */
    deleteLine(windowName?: string): void {
        const con = this.getConsole(windowName);
        if (!con) return;
        const buf = con.getBuffer();
        if (this.inTriggerProcessing && buf) {
            buf.markAsDeleted();
            return;
        }
        con.deleteLine();
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

    // ── Command-line action (Mudlet setCmdLineAction) ─────────────────────────
    // When set, the action receives every Enter-submitted line *before* alias
    // matching and the MUD send. The script fully owns the command bar — it
    // may parse, store, route, or re-emit the text via send()/expandAlias().
    private cmdLineAction: ((text: string) => void) | null = null;

    setCmdLineAction(fn: ((text: string) => void) | null): void {
        this.cmdLineAction = fn;
    }

    /** Engine-side accessor: returns the currently registered action, or null. */
    getCmdLineAction(): ((text: string) => void) | null {
        return this.cmdLineAction;
    }

    // ── Stylesheets (Mudlet setAppStyleSheet / setUserWindowStyleSheet) ───────
    // Real Mudlet APIs that scripts (theme switchers, package CSS) depend on.
    // Browser equivalent: install or replace a `<style>` tag in document.head
    // keyed by `tag` (app-wide) or window name (per-window). Per-window CSS is
    // translated through `userWindowQssToScopedCss`: `QWidget { … }` (the
    // canonical Mudlet selector) auto-scopes to `[data-mudix-window="name"]`,
    // so a stylesheet like `QWidget { padding: 15 20; }` actually pads the
    // window viewport. Scripts can still write the attribute selector
    // explicitly for non-`QWidget` rules. After a successful app-level install
    // we raise sysAppStyleSheetChange via `eventRaiser` so themes can hook
    // re-applies.

    private eventRaiser: ((event: string, args: unknown[]) => void) | null = null;

    setEventRaiser(fn: ((event: string, args: unknown[]) => void) | null): void {
        this.eventRaiser = fn;
    }

    setAppStyleSheet(css: string, tag?: string): boolean {
        const key = tag && tag.length > 0 ? tag : 'default';
        const id = `mudix-app-stylesheet-${key}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            el.dataset.mudixAppStylesheet = key;
            document.head.appendChild(el);
        }
        el.textContent = css ?? '';
        this.eventRaiser?.('sysAppStyleSheetChange', [css ?? '', tag ?? '']);
        return true;
    }

    setUserWindowStyleSheet(name: string, css: string): boolean {
        if (!name) return false;
        const id = `mudix-userwindow-stylesheet--${name}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            el.dataset.mudixUserwindowStylesheet = name;
            document.head.appendChild(el);
        }
        const scope = `[data-mudix-window="${cssEscape(name)}"]`;
        el.textContent = userWindowQssToScopedCss(css ?? '', scope);
        return true;
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

    /**
     * Mudlet `getTime()` — current local time as a record. The Bridge.lua wrapper
     * picks fields off this object for the `{year, month, day, hour, min, sec,
     * msec}` table form, and uses `wday` (0=Sun..6=Sat) to format `ddd`/`dddd`
     * tokens when the script asks for a formatted string.
     */
    getTime(): { year: number; month: number; day: number; hour: number; min: number; sec: number; msec: number; wday: number } {
        const d = new Date();
        return {
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            hour: d.getHours(),
            min: d.getMinutes(),
            sec: d.getSeconds(),
            msec: d.getMilliseconds(),
            wday: d.getDay(),
        };
    }

    /**
     * Mudlet `getNetworkLatency()` — round-trip time of the most recent
     * keep-alive ping. Returns the last measured value (in ms) for as long as
     * the connection is up; -1 when no measurement has been made yet (mirrors
     * Mudlet's "not yet measured" sentinel — better than a fake 0 which would
     * read as "instant" in scripts charting latency).
     */
    getNetworkLatency(): number {
        const fresh = this.session.ping;
        if (fresh != null) {
            this.lastPingMs = fresh;
            return fresh;
        }
        return this.lastPingMs ?? -1;
    }

    private lastPingMs: number | null = null;

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
        if (!this.inTriggerProcessing) buf.rerender();
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
