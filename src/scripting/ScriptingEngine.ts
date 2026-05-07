import type { MudSession, ScriptLogSource, ScriptLogSourceKind } from '../mud/MudSession';
import type { AliasEngine, AliasNode } from '../mud/aliases/AliasEngine';
import type { TriggerEngine, TriggerNode } from '../mud/triggers/TriggerEngine';
import type { TimerEngine, TimerNode } from '../mud/timers/TimerEngine';
import type { KeyEngine, KeyNode } from '../mud/keybindings/KeyEngine';
import type { ButtonNode, ScriptNode } from '../storage/schema';
import { isEffectivelyEnabled } from '../storage/schema';
import type { RgbColor, FormatStateSnapshot } from '../mud/text/FormatState';
import { AnsiAwareBuffer } from '../mud/text/FormatState';
import { ScriptingAPI } from './ScriptingAPI';
import { LuaRuntime } from './lua/LuaRuntime';
import type { IScriptingRuntime } from './IScriptingRuntime';
import { ProfileVFS } from './vfs/ProfileVFS';
import { MapOpenNotifier } from './MapOpenNotifier';

function hexToRgb(hex: string): RgbColor | null {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    return { space: 'rgb', r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

// Lua chunks loaded with `loadstring(code, "@" .. name)` produce errors as
// `<name>:LINE: msg` (the `@` tells Lua to treat the name as a source file —
// no `[string "..."]` wrapping). Without `@` the format is `[string "<name>"]:LINE: msg`.
// We accept both by matching the first `:DIGITS: ` (trailing space ensures we
// hit the line/message separator, not a digit run inside the name).
const LUA_LINE_RE = /:(\d+):\s/;
function parseLuaErrorLine(msg: string): number | undefined {
    const m = LUA_LINE_RE.exec(msg);
    if (!m) return undefined;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function formatErrorPrefix(kind: ScriptLogSourceKind, name: string): string {
    switch (kind) {
        case 'script':
        case 'alias':
            return name;
        case 'trigger': return `trigger "${name}"`;
        case 'timer':   return `timer "${name}"`;
        case 'key':     return `key "${name}"`;
        case 'button':  return `button "${name}"`;
    }
}

// Some MUDs send lines that carry only ANSI colour codes (no visible text) between
// real output lines — an artifact of how they format their output.  Filtering them
// removes unintended blank lines, but also removes intentional spacing in MUDs that
// use ANSI-only lines deliberately.  Toggle this flag per preference.
const FILTER_ANSI_ONLY_LINES = true;

export class ScriptingEngine {
    private runtimes: { lua: IScriptingRuntime | null } = { lua: null };
    private readonly unsubs: (() => void)[] = [];
    private readonly api: ScriptingAPI;
    private promptPending = false;
    private vfs: ProfileVFS | null = null;
    private loadGeneration = 0;
    private readonly runtimeReady: Promise<IScriptingRuntime>;
    private readonly mapOpen = new MapOpenNotifier(() => this.raiseEvent('mapOpenEvent'));
    // Serializes flushLines batches now that processLineTriggers is async.
    // Each batch chains onto the previous so line ordering is preserved when
    // a Lua-pattern trigger awaits a DB call mid-evaluation.
    private flushQueue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly session: MudSession,
        private readonly aliasEngine: AliasEngine,
        private readonly triggerEngine: TriggerEngine,
        private readonly timerEngine: TimerEngine,
        private readonly keyEngine: KeyEngine,
        connectionId: string,
        connectionName = '',
    ) {
        this.api = new ScriptingAPI(session, aliasEngine, triggerEngine, timerEngine, keyEngine);
        this.api.profileName = connectionName;
        this.bridgeEvents(session);
        this.runtimeReady = this.initRuntime(connectionId);
    }

    private initRuntime(connectionId: string): Promise<IScriptingRuntime> {
        return ProfileVFS.mount(connectionId).then(
            vfs  => { this.vfs = vfs;   return this.createRuntime(vfs); },
            err  => {
                console.error('[ScriptingEngine] VFS mount failed:', err);
                this.api.printError(`[scripting] VFS mount failed: ${err instanceof Error ? err.message : String(err)}`);
                return this.createRuntime(null);
            },
        );
    }

    private createRuntime(vfs: ProfileVFS | null): Promise<IScriptingRuntime> {
        return LuaRuntime.create(this.api, vfs).then(rt => {
            this.runtimes.lua = rt;
            this.api.setExecuteScript((code) => {
                const lua = this.runtimes.lua;
                if (!lua) return;
                lua.run(code, 'link')
                    .then(() => this.api.flushOutput())
                    .catch(err => this.api.printError(`[link] ${err instanceof Error ? err.message : String(err)}`));
            });
            this.api.setExpandAlias((text, echo) => {
                if (!this.processInput(text)) void this.api.send(text, echo);
            });
            this.api.setSendRequestDispatcher(async (text) =>
                (await this.runtimes.lua?.dispatchSendRequest(text)) ?? false);
            this.api.setFeedDispatcher((groups) => this.enqueueFeedBatch(groups));
            this.triggerEngine.setLuaEval(async (code) => {
                const lua = this.runtimes.lua;
                return lua ? await lua.evalTriggerPattern(code) : false;
            });
            return rt;
        }).catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[ScriptingEngine] Lua runtime init failed:', err);
            this.api.printError(`[scripting] Lua runtime init failed: ${msg}`);
            throw err;
        });
    }

    loadScripts(scripts: ScriptNode[]): void {
        const gen = ++this.loadGeneration;
        this.runtimeReady
            .then(async rt => {
                if (gen !== this.loadGeneration) return;
                try {
                    const enabled = scripts.filter(s => s.language === 'lua' && isEffectivelyEnabled(s, scripts));
                    for (const s of enabled) {
                        if (!s.code) continue;
                        try {
                            await rt.load(this.wrapScript(s), s.name);
                        } catch (err) {
                            this.reportEntityError('script', s.id, s.name, err);
                        }
                    }
                    this.raiseEvent('sysLoadEvent');
                    if (this.api.windows.isVisible('map')) {
                        this.mapOpen.notify();
                    }
                } catch (err) {
                    this.api.printError(`[scripting] script load error: ${err instanceof Error ? err.message : String(err)}`);
                }
                this.api.flushOutput();
            })
            .catch(err => this.api.printError(`[scripting] Lua runtime failed to initialize: ${err instanceof Error ? err.message : String(err)}`));
    }

    /** Run a single script on the existing runtime without restarting it. */
    async reloadScript(script: ScriptNode): Promise<void> {
        if (script.language !== 'lua' || !script.code) return;
        let rt: IScriptingRuntime;
        try { rt = await this.runtimeReady; } catch { return; }
        try {
            await rt.load(this.wrapScript(script), script.name);
        } catch (err) {
            this.reportEntityError('script', script.id, script.name, err);
        }
        this.api.flushOutput();
    }

    get currentVFS(): ProfileVFS | null { return this.vfs; }

    /** Start all enabled permanent timers. Called when the timer list changes. */
    loadPermTimers(timers: TimerNode[]): void {
        this.timerEngine.loadPerm(timers, (timer) => {
            if (timer.command) void this.api.send(timer.command, false);
            if (timer.code && timer.language === 'lua') {
                this.runtimes.lua?.run(timer.code, `timer "${timer.name}"`)
                    .catch(err => this.reportEntityError('timer', timer.id, timer.name, err));
            }
            this.api.flushOutput();
        });
    }

    /** Reload permanent keybindings into the engine. Called when the keybinding list changes. */
    loadPermKeybindings(keybindings: KeyNode[]): void {
        this.keyEngine.loadPerm(keybindings);
    }

    /**
     * Send a command from the command bar. Raises sysDataSendRequest, then either
     * sends (and echoes locally) or aborts when a handler calls denyCurrentSend().
     */
    sendCommand(text: string): void {
        void this.api.send(text, true);
    }

    /** Run input through aliases. Returns true if an alias matched (caller should not send). */
    processInput(text: string): boolean {
        // JS temp aliases
        if (this.aliasEngine.processTemp(text)) {
            this.api.flushOutput();
            return true;
        }
        // Permanent aliases
        const permMatch = this.aliasEngine.matchPerm(text);
        if (permMatch) {
            this.executePermAlias(permMatch.alias, [text, ...permMatch.captures]);
            this.api.flushOutput();
            return true;
        }
        this.api.flushOutput();
        return false;
    }

    /** Process a keyboard event. Returns true if a keybinding consumed it. */
    processKey(event: KeyboardEvent): boolean {
        // JS temp keybindings
        if (this.keyEngine.processTemp(event)) {
            this.api.flushOutput();
            return true;
        }
        // Permanent keybindings
        const permMatch = this.keyEngine.matchPerm(event);
        if (permMatch) {
            this.executePermKeybinding(permMatch);
            this.api.flushOutput();
            return true;
        }
        this.api.flushOutput();
        return false;
    }

    raiseEvent(event: string, args: unknown[] = []): void {
        this.emit(event, args);
    }

    notifyMapOpen(): void {
        this.mapOpen.notify();
    }

    destroy(): void {
        this.loadGeneration++;
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
        this.runtimes.lua?.destroy();
        this.runtimes.lua = null;
        this.triggerEngine.setLuaEval(null);
        this.api.setExecuteScript(null);
        this.api.setExpandAlias(null);
        this.api.setSendRequestDispatcher(null);
        this.api.destroy();
        const oldVfs = this.vfs;
        this.vfs = null;
        // Drain any pending writes (folder-backed VFS uses async write-through);
        // the unmount tears down the in-memory cache so stale dirty state would
        // otherwise be lost. Fire-and-forget — destroy is sync and we don't want
        // to block teardown on a slow disk write.
        oldVfs?.flush().finally(() => oldVfs.unmount());
    }

    // Tag a Lua error with the source entity (kind + id + name + line) so the
    // error log can render a jump-to-source button. `printError` forwards the
    // source through the script.log event into the session buffer.
    private reportEntityError(
        kind: ScriptLogSourceKind,
        id: string,
        name: string,
        err: unknown,
    ): void {
        const msg = err instanceof Error ? err.message : String(err);
        const source: ScriptLogSource = { kind, id, name };
        const line = parseLuaErrorLine(msg);
        if (line !== undefined) source.line = line;
        this.api.printError(`[${formatErrorPrefix(kind, name)}] ${msg}`, source);
    }

    // If the script declares eventHandlers, wrap it so the code runs as a
    // handler function rather than at load time (mirrors Mudlet TScript).
    private wrapScript(script: ScriptNode): string {
        if (script.eventHandlers.length === 0) return script.code;
        const safeId = script.id.replace(/-/g, '_');
        const registrations = script.eventHandlers
            .map(e => `registerAnonymousEventHandler(${JSON.stringify(e)}, __handler_${safeId})`)
            .join('\n');
        return `local __handler_${safeId} = function(event, ...)\n${script.code}\nend\n${registrations}`;
    }

    private executePermAlias(alias: AliasNode, matches: string[]): void {
        if (alias.command) {
            const cmd = alias.command.replace(/%(\d)/g, (_, d) => {
                const idx = Number(d);
                return idx === 0 ? matches[0] : (matches[idx] ?? '');
            });
            void this.api.send(cmd);
        }
        if (alias.code && alias.language === 'lua') {
            this.runtimes.lua?.runWithMatches(alias.code, alias.name, matches)
                .catch(err => this.reportEntityError('alias', alias.id, alias.name, err));
        }
    }

    private executePermTrigger(
        trigger: TriggerNode,
        matches: string[],
        matchedText: string,
        multimatches?: string[][],
        namedGroups?: Record<string, string>,
    ): void {
        // Built-in command send
        if (trigger.command) {
            const cmd = trigger.command.replace(/%(\d)/g, (_, d) => {
                const idx = Number(d);
                return idx === 0 ? matches[0] : (matches[idx] ?? '');
            });
            void this.api.send(cmd, false);
        }

        // Built-in highlight
        if (trigger.highlight && matchedText) {
            const { fg, bg } = trigger.highlight;
            if (fg || bg) {
                const idx = this.api.selectString(matchedText, 1);
                if (idx >= 0) {
                    const fgColor = fg ? hexToRgb(fg) : null;
                    const bgColor = bg ? hexToRgb(bg) : null;
                    if (fgColor || bgColor) {
                        this.api.applyFormatToSelection({
                            ...(fgColor ? { foreground: fgColor } : {}),
                            ...(bgColor ? { background: bgColor } : {}),
                        });
                    }
                    this.api.deselect();
                }
            }
        }

        // User code
        if (trigger.code && trigger.language === 'lua') {
            this.runtimes.lua?.runWithMatches(trigger.code, trigger.name, matches, multimatches, namedGroups)
                .catch(err => this.reportEntityError('trigger', trigger.id, trigger.name, err));
        }
    }

    private executePermKeybinding(binding: KeyNode): void {
        if (binding.command) void this.api.send(binding.command, false);
        if (binding.code && binding.language === 'lua') {
            this.runtimes.lua?.run(binding.code, `key "${binding.name}"`)
                .catch(err => this.reportEntityError('key', binding.id, binding.name, err));
        }
    }

    /**
     * Run a button's command + code. The Lua `code` runs on every click.
     * For two-state buttons, `nextState=true` (going DOWN) sends `commandDown`,
     * otherwise (going UP, or single-state click) sends `command`.
     */
    executeButton(button: ButtonNode, nextState: boolean): void {
        const goingDown = button.isPushDown && nextState;
        const cmd = goingDown ? button.commandDown : button.command;
        if (cmd) void this.api.send(cmd, false);
        if (button.code && button.language === 'lua') {
            this.runtimes.lua?.run(button.code, `button "${button.name}"`)
                .catch(err => this.reportEntityError('button', button.id, button.name, err));
        }
        this.api.flushOutput();
    }

    /**
     * Run a flushLines batch end-to-end: triggers, rendering, then deferred-echo
     * flush. Shared between the network-driven flushLines listener and the
     * scripting `feedTriggers` API so both paths preserve identical semantics
     * (line ordering, ANSI carry, trigger-echo placement).
     */
    private async processFlushBatch(groups: { text: string; type: string }[]): Promise<void> {
        const session = this.session;
        for (const { text, type } of groups) {
            try {
                const lines = text.split('\n');
                if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

                let carryState: FormatStateSnapshot | undefined;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const plain = line.replace(ANSI_RE, '');
                    const isPrompt = this.promptPending && i === lines.length - 1;
                    if (isPrompt) this.promptPending = false;

                    const buffer = new AnsiAwareBuffer(line, carryState);
                    carryState = buffer.trailingState();

                    if (plain.length > 0) {
                        await this.processLineTriggers(plain, buffer, isPrompt);
                        this.emit('output', [line, type]);
                    }

                    const shouldRender =
                        !buffer.deleted &&
                        (line === '' || plain.length > 0 || !FILTER_ANSI_ONLY_LINES);
                    if (shouldRender) {
                        session.events.emit('message', buffer, type, Date.now());
                    }
                }
            } finally {
                // Flush trigger echoes after the group renders so they never
                // interleave with the batch. `finally` guarantees isDeferringEcho
                // is reset even if processing throws.
                this.api.flushDeferredEcho();
            }
        }
    }

    /**
     * Used by ScriptingAPI.feedTriggers — chains a synthetic batch onto the
     * same queue as network-driven flushLines so order is preserved, and
     * returns the tail Promise so Lua's __await can block until trigger
     * processing (including DB awaits inside handlers) finishes.
     */
    enqueueFeedBatch(groups: { text: string; type: string }[]): Promise<void> {
        const tail = this.flushQueue.then(() => this.processFlushBatch(groups));
        // Swallow the rejection on the queue copy so a failing feed doesn't
        // poison subsequent batches; the unwrapped `tail` still rejects so the
        // feed caller (and Lua __await) sees the error.
        this.flushQueue = tail.catch(() => undefined);
        return tail;
    }

    /**
     * Run all triggers against `plain` (the original ANSI-stripped text).
     * Trigger handlers that call selectString/fg/bg/deleteLine modify `buffer`
     * in-place. The buffer is NOT rendered here — the caller renders it after
     * this returns, so the final rendered line already has all colorization.
     *
     * echo/cecho output from trigger handlers is deferred (via ScriptingAPI)
     * and flushed after all lines in the batch are rendered.
     *
     * Async because Lua-pattern triggers may await DB calls. processFlushBatch
     * awaits this so lines remain in arrival order even when a pattern yields
     * mid-evaluation.
     */
    private async processLineTriggers(plain: string, buffer: AnsiAwareBuffer, isPrompt = false): Promise<void> {
        this.api.setLineBuffer(buffer);
        try {
            this.runtimes.lua?.setCurrentLine(plain, isPrompt);
            this.triggerEngine.processTemp(plain);
            const matches = await this.triggerEngine.matchPerm(plain, isPrompt);
            for (const { trigger, captures, matchedText, multimatches, namedGroups } of matches) {
                this.executePermTrigger(trigger, [plain, ...captures], matchedText, multimatches, namedGroups);
            }
        } finally {
            this.api.clearLineBuffer();
        }
    }

    private emit(event: string, args: unknown[]): void {
        // emitEvent is async (handlers may await DB calls, etc.). Fire-and-forget;
        // the runtime's queue serializes handlers so ordering is preserved relative
        // to other queued Lua work. The runtime flushes its own output on completion.
        void this.runtimes.lua?.emitEvent(event, args).catch(err =>
            this.api.printError(`[event "${event}"] ${err instanceof Error ? err.message : String(err)}`));
    }

    private bridgeEvents(session: MudSession): void {
        this.unsubs.push(
            session.events.on('prompt', () => {
                this.promptPending = true;
            }),
            session.events.on('flushLines', (groups) => {
                // Serialize batch processing: trigger eval is now async (Lua-pattern
                // triggers may await DB), so chained .then() ensures batch N+1
                // doesn't start before batch N finishes — preserving line order
                // and ANSI carry state continuity.
                this.flushQueue = this.flushQueue.then(() => this.processFlushBatch(groups))
                    .catch(err => {
                        this.api.printError(`[scripting] line flush failed: ${err instanceof Error ? err.message : String(err)}`);
                    });
            }),
            session.events.on('client.connect', () => this.emit('connect', [])),
            session.events.on('client.disconnect', () => this.emit('disconnect', [])),
            session.events.on('gmcp', ({ path, value }) => {
                console.log('[gmcp]', path, value);
                this.api.updateGmcp(path, value);
                this.emit('gmcp', [path, value]);
            }),
            session.events.on('package.installed', (name) => {
                this.raiseEvent('sysInstall', [name]);
                this.raiseEvent('sysInstallPackage', [name]);
            }),
            session.events.on('package.uninstalled', (name) => {
                this.raiseEvent('sysUninstall', [name]);
                this.raiseEvent('sysUninstallPackage', [name]);
            }),
        );
    }
}
