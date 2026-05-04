import type { MudSession } from '../mud/MudSession';
import type { AliasEngine, AliasNode } from '../mud/aliases/AliasEngine';
import type { TriggerEngine, TriggerNode } from '../mud/triggers/TriggerEngine';
import type { TimerEngine, TimerNode } from '../mud/timers/TimerEngine';
import type { KeyEngine, KeyNode } from '../mud/keybindings/KeyEngine';
import type { ScriptNode } from '../storage/schema';
import { isEffectivelyEnabled } from '../storage/schema';
import type { RgbColor } from '../mud/text/FormatState';
import { AnsiAwareBuffer } from '../mud/text/FormatState';
import { ScriptingAPI } from './ScriptingAPI';
import { LuaRuntime } from './lua/LuaRuntime';
import type { IScriptingRuntime } from './IScriptingRuntime';

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

    constructor(
        session: MudSession,
        private readonly aliasEngine: AliasEngine,
        private readonly triggerEngine: TriggerEngine,
        private readonly timerEngine: TimerEngine,
        private readonly keyEngine: KeyEngine,
    ) {
        this.api = new ScriptingAPI(session, aliasEngine, triggerEngine);
        this.bridgeEvents(session);
    }

    /** Load (or reload) scripts. Restarts each runtime cleanly. */
    loadScripts(scripts: ScriptNode[]): void {
        this.runtimes.lua?.destroy();
        this.triggerEngine.setLuaEval(null);
        try {
            const rt = new LuaRuntime(this.api);
            this.runtimes.lua = rt;
            this.triggerEngine.setLuaEval((code, line) => (this.runtimes.lua as LuaRuntime | null)?.evalBoolean(code, line) ?? false);
            const enabled = scripts.filter(s => s.language === 'lua' && isEffectivelyEnabled(s, scripts));
            for (const s of enabled) {
                if (!s.code) continue;
                rt.load(this.wrapScript(s), s.name);
            }
        } catch (err) {
            this.runtimes.lua = null;
            this.triggerEngine.setLuaEval(null);
            this.api.printError(`[scripting] Lua runtime failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.api.flushOutput();
    }

    /** Run a single script on the existing runtime without restarting it. */
    reloadScript(script: ScriptNode): void {
        if (script.language !== 'lua') return;
        if (!this.runtimes.lua) {
            try {
                this.runtimes.lua = new LuaRuntime(this.api);
            } catch (err) {
                this.api.printError(`[scripting] Lua runtime failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
                return;
            }
        }
        if (!script.code) return;
        this.runtimes.lua.load(this.wrapScript(script), script.name);
        this.api.flushOutput();
    }

    /** Start all enabled permanent timers. Called when the timer list changes. */
    loadPermTimers(timers: TimerNode[]): void {
        this.timerEngine.loadPerm(timers, (timer) => {
            if (timer.command) this.api.send(timer.command, false);
            if (timer.code && timer.language === 'lua') this.runtimes.lua?.run(timer.code, timer.name);
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

    destroy(): void {
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
        this.runtimes.lua?.destroy();
        this.runtimes.lua = null;
        this.triggerEngine.setLuaEval(null);
        this.api.destroy();
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
            this.runtimes.lua?.runWithMatches(alias.code, alias.name, matches);
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
            this.runtimes.lua?.runWithMatches(trigger.code, trigger.name, matches, multimatches, namedGroups);
        }
    }

    private executePermKeybinding(binding: KeyNode): void {
        if (binding.command) this.api.send(binding.command, false);
        if (binding.code && binding.language === 'lua') {
            this.runtimes.lua?.run(binding.code, binding.name);
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
        (this.runtimes.lua as LuaRuntime | null)?.setCurrentLine(plain, isPrompt);
        this.triggerEngine.processTemp(plain);
        for (const { trigger, captures, matchedText, multimatches, namedGroups } of this.triggerEngine.matchPerm(plain, isPrompt)) {
            this.executePermTrigger(trigger, [plain, ...captures], matchedText, multimatches, namedGroups);
        }
        this.runtimes.lua?.processTrigger(plain);
        this.api.clearLineBuffer();
        // Do NOT call flushOutput here — ScriptingEngine.bridgeEvents handles
        // the flush after render via flushDeferredEcho().
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
                    const lines = text.split('\n');
                    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        const plain = line.replace(ANSI_RE, '');
                        const isPrompt = this.promptPending && i === lines.length - 1;
                        if (isPrompt) this.promptPending = false;

                        // Build the buffer before triggers so handlers can colour it.
                        const buffer = new AnsiAwareBuffer(line);

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

                    // 3. After all lines in the group are rendered, flush any echo
                    //    output that trigger handlers produced. This ensures trigger
                    //    echo always appears after the batch, never interleaved with it.
                    this.api.flushDeferredEcho();
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
