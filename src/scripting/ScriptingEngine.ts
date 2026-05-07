import type {MudSession, ScriptLogSource, ScriptLogSourceKind} from '../mud/MudSession';
import type {AliasEngine, AliasNode} from '../mud/aliases/AliasEngine';
import {TriggerEngine, type TriggerNode} from '../mud/triggers/TriggerEngine';
import type {TimerEngine} from '../mud/timers/TimerEngine';
import type {KeyEngine, KeyNode} from '../mud/keybindings/KeyEngine';
import type {ButtonNode, ScriptNode} from '../storage/schema';
import {isEffectivelyEnabled} from '../storage/schema';
import {useAppStore} from '../storage';
import type {FormatStateSnapshot, RgbColor} from '../mud/text/FormatState';
import {AnsiAwareBuffer} from '../mud/text/FormatState';
import {ScriptingAPI} from './ScriptingAPI';
import {LuaRuntime} from './lua/LuaRuntime';
import type {IScriptingRuntime} from './IScriptingRuntime';
import {ProfileVFS} from './vfs/ProfileVFS';
import {MapOpenNotifier} from './MapOpenNotifier';

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
    private readonly runtimeReady: Promise<IScriptingRuntime>;
    private readonly mapOpen = new MapOpenNotifier(() => this.raiseEvent('mapOpenEvent'));
    private readonly connectionId: string;
    private storeUnsub: (() => void) | null = null;
    // Triggers can't apply until the PCRE wasm has initialized — we hold
    // off the first apply (and any subsequent store updates for triggers)
    // until TriggerEngine.ready() resolves.
    private triggersReady = false;
    // Last seen script list for the active connection. Used to diff against
    // the next store update so we know which scripts to load/unload.
    private prevScripts: ScriptNode[] = [];

    constructor(
        private readonly session: MudSession,
        private readonly aliasEngine: AliasEngine,
        private readonly triggerEngine: TriggerEngine,
        private readonly timerEngine: TimerEngine,
        private readonly keyEngine: KeyEngine,
        connectionId: string,
        connectionName = '',
        private readonly proxyUrlGetter: () => string | undefined = () => undefined,
    ) {
        this.api = new ScriptingAPI(session, aliasEngine, triggerEngine, timerEngine, keyEngine);
        this.api.profileName = connectionName;
        this.connectionId = connectionId;
        this.bridgeEvents(session);
        this.runtimeReady = this.initRuntime(connectionId);
        this.attachToStore(session);
    }

    /**
     * Subscribe to the appStore and apply diffs synchronously on every
     * mutation. Zustand fires subscribers synchronously inside `set()`, so a
     * UI action like `installPackage(...)` immediately propagates into the
     * Lua runtime — handlers register before the caller's next line runs.
     * That guarantee is what lets `notifyPackageInstalled` raise its event
     * right after the store update without a React commit in between.
     *
     * Covers all five entity types — scripts, aliases, triggers, timers,
     * keybindings — so the engine is the single owner of the
     * store-to-runtime mapping. The UI just dispatches store actions.
     *
     * The first apply is gated on `output.ready` because some scripts open
     * windows on load and the dock system needs to be wired up first.
     * Triggers additionally wait for the PCRE wasm via TriggerEngine.ready()
     * — patterns won't compile before that.
     */
    private attachToStore(session: MudSession): void {
        const start = () => {
            console.info('[engine][attachToStore] start (output.ready cleared)', { connectionId: this.connectionId });
            this.applyScriptsFromStore();
            this.applyAliasesFromStore();
            this.applyTimersFromStore();
            this.applyKeybindingsFromStore();
            // sysLoadEvent fires once after the initial script load.
            // Map-open notification keeps map-aware scripts in sync if the
            // map is already visible at connection time.
            this.raiseEvent('sysLoadEvent');
            if (this.api.windows.isVisible('map')) this.mapOpen.notify();
            this.api.flushOutput();

            // Triggers need PCRE wasm; until that resolves, skip apply on
            // the initial pass and on subsequent store updates. Once ready,
            // apply whatever the store says now.
            void TriggerEngine.ready().then(() => {
                console.info('[engine][attachToStore] triggers wasm ready', { connectionId: this.connectionId });
                this.triggersReady = true;
                this.applyTriggersFromStore();
            });

            this.storeUnsub = useAppStore.subscribe((state, prevState) => {
                const id = this.connectionId;
                if (state.connectionScripts[id]      !== prevState.connectionScripts[id])      this.applyScriptsFromStore();
                if (state.connectionAliases[id]      !== prevState.connectionAliases[id])      this.applyAliasesFromStore();
                if (state.connectionTimers[id]       !== prevState.connectionTimers[id])       this.applyTimersFromStore();
                if (state.connectionKeybindings[id]  !== prevState.connectionKeybindings[id])  this.applyKeybindingsFromStore();
                if (this.triggersReady && state.connectionTriggers[id] !== prevState.connectionTriggers[id]) {
                    this.applyTriggersFromStore();
                }
            });
        };
        if (session.outputReady) {
            console.info('[engine][attachToStore] output already ready, starting now', { connectionId: this.connectionId });
            start();
        } else {
            console.info('[engine][attachToStore] waiting for output.ready', { connectionId: this.connectionId });
            this.unsubs.push(session.events.on('output.ready', start, { once: true }));
        }
    }

    private applyAliasesFromStore(): void {
        const aliases = useAppStore.getState().connectionAliases[this.connectionId] ?? [];
        console.info('[engine][apply] aliases', { connectionId: this.connectionId, count: aliases.length });
        this.aliasEngine.loadPerm(aliases);
    }

    private applyTriggersFromStore(): void {
        const triggers = useAppStore.getState().connectionTriggers[this.connectionId] ?? [];
        console.info('[engine][apply] triggers', { connectionId: this.connectionId, count: triggers.length });
        this.triggerEngine.loadPerm(triggers);
    }

    private applyTimersFromStore(): void {
        const timers = useAppStore.getState().connectionTimers[this.connectionId] ?? [];
        console.info('[engine][apply] timers', { connectionId: this.connectionId, count: timers.length });
        this.timerEngine.loadPerm(timers, (timer) => {
            if (timer.command) this.api.send(timer.command, false);
            if (timer.code && timer.language === 'lua') {
                try {
                    this.runtimes.lua?.run(timer.code, `timer "${timer.name}"`);
                } catch (err) {
                    this.reportEntityError('timer', timer.id, timer.name, err);
                }
            }
            this.api.flushOutput();
        });
    }

    private applyKeybindingsFromStore(): void {
        const keys = useAppStore.getState().connectionKeybindings[this.connectionId] ?? [];
        console.info('[engine][apply] keybindings', { connectionId: this.connectionId, count: keys.length });
        this.keyEngine.loadPerm(keys);
    }

    private applyScriptsFromStore(): void {
        const next = useAppStore.getState().connectionScripts[this.connectionId] ?? [];
        const prev = this.prevScripts;
        this.prevScripts = next;
        if (prev === next) return;

        const prevEnabled = new Map(
            prev.filter(s => s.language === 'lua' && isEffectivelyEnabled(s, prev))
                .map(s => [s.id, s] as const),
        );
        const nextEnabledIds = new Set(
            next.filter(s => s.language === 'lua' && isEffectivelyEnabled(s, next))
                .map(s => s.id),
        );
        console.info('[engine][apply] scripts', {
            connectionId: this.connectionId,
            total: next.length,
            enabled: nextEnabledIds.size,
        });

        for (const id of prevEnabled.keys()) {
            if (!nextEnabledIds.has(id)) this.unloadScript(id);
        }
        for (const s of next) {
            if (s.language !== 'lua' || !isEffectivelyEnabled(s, next)) continue;
            const was = prevEnabled.get(s.id);
            const handlersChanged = !!was && was.eventHandlers.join('\n') !== s.eventHandlers.join('\n');
            if (!was || was.code !== s.code || handlersChanged) {
                this.reloadScript(s);
            }
        }
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
        return LuaRuntime.create(this.api, vfs, this.proxyUrlGetter).then(rt => {
            this.runtimes.lua = rt;
            this.api.setExecuteScript((code) => {
                const lua = this.runtimes.lua;
                if (!lua) return;
                try {
                    lua.run(code, 'link');
                } catch (err) {
                    this.api.printError(`[link] ${err instanceof Error ? err.message : String(err)}`);
                }
                this.api.flushOutput();
            });
            this.api.setExpandAlias((text, echo) => {
                if (!this.processInput(text)) this.api.send(text, echo);
            });
            this.api.setSendRequestDispatcher((text) =>
                this.runtimes.lua?.dispatchSendRequest(text) ?? false);
            this.api.setFeedDispatcher((groups) => this.processFlushBatch(groups));
            this.triggerEngine.setLuaEval((code) => {
                const lua = this.runtimes.lua;
                return lua ? lua.evalTriggerPattern(code) : false;
            });
            return rt;
        }).catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[ScriptingEngine] Lua runtime init failed:', err);
            this.api.printError(`[scripting] Lua runtime init failed: ${msg}`);
            throw err;
        });
    }

    /**
     * Tear down a script's event-handler registrations. Used when a script is
     * removed or transitions enabled→disabled so its handlers stop firing
     * before the next full runtime reload.
     *
     * Runs synchronously once the runtime is up so the store-subscription
     * pipeline (script removed → handlers gone) completes inside the same
     * tick as the store mutation. See attachToStore for the rationale.
     */
    unloadScript(scriptId: string): void {
        const rt = this.runtimes.lua;
        if (rt) { rt.killScriptHandlers(scriptId); return; }
        this.runtimeReady.then(rt => rt.killScriptHandlers(scriptId)).catch(() => {});
    }

    /**
     * Raise sysInstall / sysInstallPackage. The caller is expected to have
     * just committed the package's items to the appStore — our subscription
     * loads the new scripts synchronously inside that commit, so by the time
     * this method runs the package's event handlers are already registered.
     */
    notifyPackageInstalled(packageName: string): void {
        this.raiseEvent('sysInstall', [packageName]);
        this.raiseEvent('sysInstallPackage', [packageName]);
    }

    /**
     * Raise sysUninstall / sysUninstallPackage. Call this BEFORE removing the
     * package's items from the store so the package's own handlers (and the
     * scripts they live in) are still loaded when the event fires.
     */
    notifyPackageUninstalled(packageName: string): void {
        this.raiseEvent('sysUninstall', [packageName]);
        this.raiseEvent('sysUninstallPackage', [packageName]);
    }

    /**
     * Run a single script on the existing runtime without restarting it.
     *
     * Runs synchronously when the runtime is already up. That sync path is
     * load-bearing: notifyPackageInstalled raises sysInstallPackage right
     * after applyScriptsFromStore returns, and the package's own event
     * handlers (and the function `_G[scriptName]` they dispatch to) must be
     * defined by then. An `await` here — even on an already-resolved promise
     * — would defer the load to a microtask and the event would fire against
     * an empty handler set.
     */
    reloadScript(script: ScriptNode): void {
        if (script.language !== 'lua' || !script.code) return;
        const rt = this.runtimes.lua;
        if (rt) { this.runScriptLoad(rt, script); return; }
        this.runtimeReady.then(rt => this.runScriptLoad(rt, script)).catch(() => {});
    }

    private runScriptLoad(rt: IScriptingRuntime, script: ScriptNode): void {
        try {
            rt.load(this.wrapScript(script), script.name);
        } catch (err) {
            this.reportEntityError('script', script.id, script.name, err);
        }
        this.api.flushOutput();
    }

    get currentVFS(): ProfileVFS | null { return this.vfs; }

    /**
     * Send a command from the command bar. Raises sysDataSendRequest, then either
     * sends (and echoes locally) or aborts when a handler calls denyCurrentSend().
     */
    sendCommand(text: string): void {
        this.api.send(text, true);
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
        this.storeUnsub?.();
        this.storeUnsub = null;
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

    // Mudlet TScript semantics: the body runs at load time (defining e.g.
    // `function MyScript(event, ...) ... end` as a global), and each event
    // handler fires by looking up the global named after the script and
    // calling it. We dispatch via _G[name] (not a direct function reference)
    // so re-saving the script picks up the new function, and so missing/
    // mistyped function names silently no-op like Mudlet.
    //
    // The wrapper also kills any previously-registered handlers for this
    // script (Bridge.lua's __mudix_script_handlers tracks IDs by script id)
    // so re-saving doesn't accumulate duplicate registrations.
    private wrapScript(script: ScriptNode): string {
        if (script.eventHandlers.length === 0) return script.code;
        const sidLiteral = JSON.stringify(script.id);
        const nameLiteral = JSON.stringify(script.name);
        const registrations = script.eventHandlers
            .map(e =>
                `__mudix_script_handlers[${sidLiteral}][#__mudix_script_handlers[${sidLiteral}]+1] = ` +
                `registerAnonymousEventHandler(${JSON.stringify(e)}, function(...) ` +
                `local __fn = _G[${nameLiteral}]; ` +
                `if type(__fn) == 'function' then return __fn(...) end ` +
                `end)`)
            .join('\n');
        return [
            `__mudix_kill_script_handlers(${sidLiteral})`,
            `__mudix_script_handlers[${sidLiteral}] = {}`,
            script.code,
            registrations,
        ].join('\n');
    }

    private executePermAlias(alias: AliasNode, matches: string[]): void {
        if (alias.command) {
            const cmd = alias.command.replace(/%(\d)/g, (_, d) => {
                const idx = Number(d);
                return idx === 0 ? matches[0] : (matches[idx] ?? '');
            });
            this.api.send(cmd);
        }
        if (alias.code && alias.language === 'lua') {
            try {
                this.runtimes.lua?.runWithMatches(alias.code, alias.name, matches);
            } catch (err) {
                this.reportEntityError('alias', alias.id, alias.name, err);
            }
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
            this.api.send(cmd, false);
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
            try {
                this.runtimes.lua?.runWithMatches(trigger.code, trigger.name, matches, multimatches, namedGroups);
            } catch (err) {
                this.reportEntityError('trigger', trigger.id, trigger.name, err);
            }
        }
    }

    private executePermKeybinding(binding: KeyNode): void {
        if (binding.command) this.api.send(binding.command, false);
        if (binding.code && binding.language === 'lua') {
            try {
                this.runtimes.lua?.run(binding.code, `key "${binding.name}"`);
            } catch (err) {
                this.reportEntityError('key', binding.id, binding.name, err);
            }
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
        if (cmd) this.api.send(cmd, false);
        if (button.code && button.language === 'lua') {
            try {
                this.runtimes.lua?.run(button.code, `button "${button.name}"`);
            } catch (err) {
                this.reportEntityError('button', button.id, button.name, err);
            }
        }
        this.api.flushOutput();
    }

    /**
     * Run a flushLines batch end-to-end: triggers, rendering, then deferred-echo
     * flush. Shared between the network-driven flushLines listener and the
     * scripting `feedTriggers` API so both paths preserve identical semantics
     * (line ordering, ANSI carry, trigger-echo placement).
     */
    private processFlushBatch(groups: { text: string; type: string }[]): void {
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
                        this.processLineTriggers(plain, buffer, isPrompt);
                        this.emit('output', [line, type]);
                    }

                    const shouldRender =
                        !buffer.deleted &&
                        (line === '' || plain.length > 0 || !FILTER_ANSI_ONLY_LINES);
                    if (shouldRender) {
                        this.session.events.emit('message', buffer, type, Date.now());
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
     * Run all triggers against `plain` (the original ANSI-stripped text).
     * Trigger handlers that call selectString/fg/bg/deleteLine modify `buffer`
     * in-place. The buffer is NOT rendered here — the caller renders it after
     * this returns, so the final rendered line already has all colorization.
     *
     * echo/cecho output from trigger handlers is deferred (via ScriptingAPI)
     * and flushed after all lines in the batch are rendered.
     */
    private processLineTriggers(plain: string, buffer: AnsiAwareBuffer, isPrompt = false): void {
        this.api.setLineBuffer(buffer);
        try {
            this.runtimes.lua?.setCurrentLine(plain, isPrompt);
            this.triggerEngine.processTemp(plain);
            const matches = this.triggerEngine.matchPerm(plain, isPrompt);
            for (const { trigger, captures, matchedText, multimatches, namedGroups } of matches) {
                this.executePermTrigger(trigger, [plain, ...captures], matchedText, multimatches, namedGroups);
            }
        } finally {
            this.api.clearLineBuffer();
        }
    }

    private emit(event: string, args: unknown[]): void {
        try {
            this.runtimes.lua?.emitEvent(event, args);
        } catch (err) {
            this.api.printError(`[event "${event}"] ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private bridgeEvents(session: MudSession): void {
        this.unsubs.push(
            session.events.on('prompt', () => {
                this.promptPending = true;
            }),
            session.events.on('flushLines', (groups) => {
                try {
                    this.processFlushBatch(groups);
                } catch (err) {
                    this.api.printError(`[scripting] line flush failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }),
            session.events.on('client.connect', () => this.emit('connect', [])),
            session.events.on('client.disconnect', () => this.emit('disconnect', [])),
            session.events.on('gmcp', ({ path, value }) => {
                console.log('[gmcp]', path, value);
                this.api.updateGmcp(path, value);
                this.emit('gmcp', [path, value]);
            }),
            // Package install/uninstall events are dispatched by callers via
            // notifyPackageInstalled / notifyPackageUninstalled (not the
            // session event bus) so we can sequence the script-load before
            // sysInstallPackage fires. See those methods for rationale.
        );
    }
}
