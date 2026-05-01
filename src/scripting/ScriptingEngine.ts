import type { MudSession } from '../mud/MudSession';
import type { AliasEngine, PermanentAlias } from '../mud/aliases/AliasEngine';
import type { TriggerEngine, PermanentTrigger } from '../mud/triggers/TriggerEngine';
import type { Script } from '../storage/schema';
import { ScriptingAPI } from './ScriptingAPI';
import { LuaRuntime } from './lua/LuaRuntime';
import type { IScriptingRuntime } from './IScriptingRuntime';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export class ScriptingEngine {
    private runtimes: { lua: IScriptingRuntime | null } = { lua: null };
    private readonly unsubs: (() => void)[] = [];
    private readonly api: ScriptingAPI;

    constructor(
        session: MudSession,
        private readonly aliasEngine: AliasEngine,
        private readonly triggerEngine: TriggerEngine,
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
            const rt = new LuaRuntime(this.api);
            this.runtimes.lua = rt;
            for (const s of lua) rt.load(s.code, s.name);
        }
        this.api.flushOutput();
    }

    /** Run a single script on the existing runtime without restarting it. */
    reloadScript(script: Script): void {
        if (script.language !== 'lua') return;
        if (!this.runtimes.lua) {
            this.runtimes.lua = new LuaRuntime(this.api);
        }
        this.runtimes.lua.load(script.code, script.name);
        this.api.flushOutput();
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
        // Lua temp aliases (PCRE matching + luaL_ref callbacks inside LuaRuntime)
        const luaMatched = this.runtimes.lua?.processInput(text) ?? false;
        this.api.flushOutput();
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

    private processLineTriggers(line: string): void {
        const plain = line.replace(ANSI_RE, '');
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
            session.events.on('flushLines', (groups) => {
                for (const { text, type } of groups) {
                    this.processLineTriggers(text);
                    this.emit('output', [text, type]);
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
