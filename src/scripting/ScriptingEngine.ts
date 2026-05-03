import type { MudSession } from '../mud/MudSession';
import type { AliasEngine, PermanentAlias } from '../mud/aliases/AliasEngine';
import type { TriggerEngine, PermanentTrigger } from '../mud/triggers/TriggerEngine';
import type { TimerEngine, PermanentTimer } from '../mud/timers/TimerEngine';
import type { KeyEngine, PermanentKeybinding } from '../mud/keybindings/KeyEngine';
import type { Script } from '../storage/schema';
import { ScriptingAPI } from './ScriptingAPI';
import { LuaRuntime } from './lua/LuaRuntime';
import type { IScriptingRuntime } from './IScriptingRuntime';

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
    loadScripts(scripts: Script[]): void {
        this.runtimes.lua?.destroy();
        this.runtimes.lua = null;

        const lua = scripts.filter(s => s.enabled && s.language === 'lua');
        if (lua.length > 0) {
            try {
                const rt = new LuaRuntime(this.api);
                this.runtimes.lua = rt;
                for (const s of lua) rt.load(s.code, s.name);
            } catch (err) {
                this.api.printError(`[scripting] Lua runtime failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        this.api.flushOutput();
    }

    /** Run a single script on the existing runtime without restarting it. */
    reloadScript(script: Script): void {
        if (script.language !== 'lua') return;
        if (!this.runtimes.lua) {
            try {
                this.runtimes.lua = new LuaRuntime(this.api);
            } catch (err) {
                this.api.printError(`[scripting] Lua runtime failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
                return;
            }
        }
        this.runtimes.lua.load(script.code, script.name);
        this.api.flushOutput();
    }

    /** Start all enabled permanent timers. Called when the timer list changes. */
    loadPermTimers(timers: PermanentTimer[]): void {
        this.timerEngine.loadPerm(timers, (code, language, name) => {
            if (language === 'lua') this.runtimes.lua?.run(code, name);
            this.api.flushOutput();
        });
    }

    /** Reload permanent keybindings into the engine. Called when the keybinding list changes. */
    loadPermKeybindings(keybindings: PermanentKeybinding[]): void {
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
        this.api.destroy();
    }

    private executePermAlias(alias: PermanentAlias, matches: string[]): void {
        if (alias.language === 'lua') {
            this.runtimes.lua?.runWithMatches(alias.code, alias.name, matches);
        }
    }

    private executePermTrigger(trigger: PermanentTrigger, matches: string[]): void {
        if (trigger.language === 'lua') {
            this.runtimes.lua?.runWithMatches(trigger.code, trigger.name, matches);
        }
    }

    private executePermKeybinding(binding: PermanentKeybinding): void {
        if (binding.language === 'lua') {
            this.runtimes.lua?.run(binding.code, binding.name);
        }
    }

    private processLineTriggers(line: string, isPrompt = false): void {
        const plain = line.replace(ANSI_RE, '');
        (this.runtimes.lua as LuaRuntime | null)?.setCurrentLine(plain, isPrompt);
        this.triggerEngine.processTemp(plain);
        for (const { trigger, captures } of this.triggerEngine.matchPerm(plain)) {
            this.executePermTrigger(trigger, [plain, ...captures]);
        }
        this.runtimes.lua?.processTrigger(plain);
        this.api.flushOutput();
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
                        // Last line in a chunk that arrived with GA/EOR is the prompt
                        const isPrompt = this.promptPending && i === lines.length - 1;
                        if (isPrompt) this.promptPending = false;
                        // Skip rendering lines that carry only ANSI codes (no visible text).
                        // Genuine blank lines (empty string) are still rendered.
                        if (line === '' || plain.length > 0 || !FILTER_ANSI_ONLY_LINES) {
                            session.events.emit('message', line, type, Date.now());
                        }
                        if (plain.length > 0) {
                            this.processLineTriggers(line, isPrompt);
                            this.emit('output', [line, type]);
                        }
                    }
                }
            }),
            session.events.on('client.connect', () => this.emit('connect', [])),
            session.events.on('client.disconnect', () => this.emit('disconnect', [])),
            session.events.on('gmcp', ({ path, value }) => {
                this.api.updateGmcp(path, value);
                this.emit('gmcp', [path, value]);
            }),
        );
    }
}
