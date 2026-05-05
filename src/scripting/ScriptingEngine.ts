import type { MudSession } from '../mud/MudSession';
import type { AliasEngine, AliasNode } from '../mud/aliases/AliasEngine';
import type { TriggerEngine, TriggerNode } from '../mud/triggers/TriggerEngine';
import type { TimerEngine, TimerNode } from '../mud/timers/TimerEngine';
import type { KeyEngine, KeyNode } from '../mud/keybindings/KeyEngine';
import type { ScriptNode } from '../storage/schema';
import { isEffectivelyEnabled } from '../storage/schema';
import type { RgbColor, FormatStateSnapshot } from '../mud/text/FormatState';
import { AnsiAwareBuffer } from '../mud/text/FormatState';
import { ScriptingAPI } from './ScriptingAPI';
import { LuaRuntime } from './lua/LuaRuntime';
import type { IScriptingRuntime } from './IScriptingRuntime';
import { ProfileVFS } from './vfs/ProfileVFS';

function hexToRgb(hex: string): RgbColor | null {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    return { space: 'rgb', r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

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
    private runtimePromise: Promise<IScriptingRuntime> | null = null;

    constructor(
        session: MudSession,
        private readonly aliasEngine: AliasEngine,
        private readonly triggerEngine: TriggerEngine,
        private readonly timerEngine: TimerEngine,
        private readonly keyEngine: KeyEngine,
    ) {
        this.api = new ScriptingAPI(session, aliasEngine, triggerEngine, timerEngine, keyEngine);
        this.bridgeEvents(session);
    }

    private createRuntime(vfs: ProfileVFS | null): Promise<IScriptingRuntime> {
        this.runtimePromise = LuaRuntime.create(this.api, vfs).then(rt => {
            this.runtimes.lua = rt;
            this.api.setExecuteScript((code) => {
                this.runtimes.lua?.run(code, 'link')
                    .then(() => this.api.flushOutput())
                    .catch(err => this.api.printError(`[link] ${err instanceof Error ? err.message : String(err)}`));
            });
            return rt;
        });
        return this.runtimePromise;
    }

    /** Load (or reload) scripts. On first call, mounts VFS and creates the runtime. */
    loadScripts(scripts: ScriptNode[], connectionId: string, connectionName = ''): void {
        this.api.profileName = connectionName;
        const gen = ++this.loadGeneration;

        const doLoad = async (rt: IScriptingRuntime) => {
            if (gen !== this.loadGeneration) return;
            try {
                const enabled = scripts.filter(s => s.language === 'lua' && isEffectivelyEnabled(s, scripts));
                for (const s of enabled) {
                    if (!s.code) continue;
                    try {
                        await rt.load(this.wrapScript(s), s.name);
                    } catch (err) {
                        this.api.printError(`[${s.name}] ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                this.raiseEvent('sysLoadEvent');
                if (this.api.windows.isVisible('map')) {
                    this.raiseEvent('mapOpenEvent');
                }
            } catch (err) {
                this.api.printError(`[scripting] script load error: ${err instanceof Error ? err.message : String(err)}`);
            }
            this.api.flushOutput();
        };

        if (!this.runtimePromise) {
            const startWithVfs = (vfs: ProfileVFS | null) => {
                if (gen !== this.loadGeneration) { vfs?.unmount(); return; }
                this.vfs = vfs;
                this.createRuntime(vfs)
                    .then(rt => doLoad(rt))
                    .catch(err => this.api.printError(`[scripting] Lua runtime failed to initialize: ${err instanceof Error ? err.message : String(err)}`));
            };

            ProfileVFS.mount(connectionId)
                .then(vfs => startWithVfs(vfs))
                .catch(err => {
                    if (gen !== this.loadGeneration) return;
                    console.error('[ScriptingEngine] VFS mount failed:', err);
                    this.api.printError(`[scripting] VFS mount failed: ${err instanceof Error ? err.message : String(err)}`);
                    startWithVfs(null);
                });
        } else {
            this.runtimePromise
                .then(rt => { if (gen !== this.loadGeneration) return; return doLoad(rt); })
                .catch(err => this.api.printError(`[scripting] Lua runtime failed to initialize: ${err instanceof Error ? err.message : String(err)}`));
        }
    }

    /** Run a single script on the existing runtime without restarting it. */
    async reloadScript(script: ScriptNode): Promise<void> {
        if (script.language !== 'lua' || !script.code) return;
        if (!this.runtimes.lua && this.runtimePromise) {
            try { await this.runtimePromise; } catch { return; }
        }
        if (!this.runtimes.lua) return;
        try {
            await this.runtimes.lua.load(this.wrapScript(script), script.name);
        } catch (err) {
            this.api.printError(`[${script.name}] ${err instanceof Error ? err.message : String(err)}`);
        }
        this.api.flushOutput();
    }

    get currentVFS(): ProfileVFS | null { return this.vfs; }

    /** Start all enabled permanent timers. Called when the timer list changes. */
    loadPermTimers(timers: TimerNode[]): void {
        this.timerEngine.loadPerm(timers, (timer) => {
            if (timer.command) this.api.send(timer.command, false);
            if (timer.code && timer.language === 'lua') {
                this.runtimes.lua?.run(timer.code, `timer "${timer.name}"`)
                    .catch(err => this.api.printError(`[timer "${timer.name}"] ${err instanceof Error ? err.message : String(err)}`));
            }
            this.api.flushOutput();
        });
    }

    /** Reload permanent keybindings into the engine. Called when the keybinding list changes. */
    loadPermKeybindings(keybindings: KeyNode[]): void {
        this.keyEngine.loadPerm(keybindings);
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
        // Lua temp aliases
        const luaMatched = this.runtimes.lua?.processInput(text) ?? false;
        this.api.flushOutput();
        return luaMatched;
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
        // Lua temp keybindings
        const luaMatched = this.runtimes.lua?.processKey(event) ?? false;
        if (luaMatched) this.api.flushOutput();
        return luaMatched;
    }

    raiseEvent(event: string, args: unknown[] = []): void {
        this.emit(event, args);
    }

    destroy(): void {
        this.loadGeneration++;
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
        this.runtimes.lua?.destroy();
        this.runtimes.lua = null;
        this.runtimePromise = null;
        this.triggerEngine.setLuaEval(null);
        this.api.setExecuteScript(null);
        this.api.destroy();
        const oldVfs = this.vfs;
        this.vfs = null;
        oldVfs?.unmount();
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
            this.api.send(cmd);
        }
        if (alias.code && alias.language === 'lua') {
            this.runtimes.lua?.runWithMatches(alias.code, alias.name, matches)
                .catch(err => this.api.printError(`[${alias.name}] ${err instanceof Error ? err.message : String(err)}`));
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
            this.runtimes.lua?.runWithMatches(trigger.code, trigger.name, matches, multimatches, namedGroups)
                .catch(err => this.api.printError(`[${trigger.name}] ${err instanceof Error ? err.message : String(err)}`));
        }
    }

    private executePermKeybinding(binding: KeyNode): void {
        if (binding.command) this.api.send(binding.command, false);
        if (binding.code && binding.language === 'lua') {
            this.runtimes.lua?.run(binding.code, `key "${binding.name}"`)
                .catch(err => this.api.printError(`[key "${binding.name}"] ${err instanceof Error ? err.message : String(err)}`));
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
            for (const { trigger, captures, matchedText, multimatches, namedGroups } of this.triggerEngine.matchPerm(plain, isPrompt)) {
                this.executePermTrigger(trigger, [plain, ...captures], matchedText, multimatches, namedGroups);
            }
            this.runtimes.lua?.processTrigger(plain);
        } finally {
            this.api.clearLineBuffer();
        }
    }

    private emit(event: string, args: unknown[]): void {
        this.runtimes.lua?.emitEvent(event, args);
        this.api.flushOutput();
    }

    private bridgeEvents(session: MudSession): void {
        this.unsubs.push(
            session.events.on('prompt', () => {
                this.promptPending = true;
            }),
            session.events.on('flushLines', (groups) => {
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

                            // Build the buffer before triggers so handlers can colour it.
                            // Pass carry state so ANSI colour set on line N continues into line N+1.
                            const buffer = new AnsiAwareBuffer(line, carryState);
                            carryState = buffer.trailingState();

                            // 1. Run triggers first — they may colour or delete the buffer.
                            if (plain.length > 0) {
                                this.processLineTriggers(plain, buffer, isPrompt);
                                this.emit('output', [line, type]);
                            }

                            // 2. Render the (possibly modified) buffer, unless a trigger
                            //    deleted it or it should be filtered.
                            const shouldRender =
                                !buffer.deleted &&
                                (line === '' || plain.length > 0 || !FILTER_ANSI_ONLY_LINES);
                            if (shouldRender) {
                                session.events.emit('message', buffer, type, Date.now());
                            }
                        }
                    } finally {
                        // 3. After all lines in the group are rendered, flush any echo
                        //    output that trigger handlers produced. This ensures trigger
                        //    echo always appears after the batch, never interleaved with it.
                        //    The finally block guarantees this runs even if processing throws,
                        //    preventing isDeferringEcho from getting permanently stuck.
                        this.api.flushDeferredEcho();
                    }
                }
            }),
            session.events.on('client.connect', () => this.emit('connect', [])),
            session.events.on('client.disconnect', () => this.emit('disconnect', [])),
            session.events.on('gmcp', ({ path, value }) => {
                console.log('[gmcp]', path, value);
                this.api.updateGmcp(path, value);
                this.emit('gmcp', [path, value]);
            }),
        );
    }
}
