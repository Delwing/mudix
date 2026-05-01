import { lauxlib, lua, lualib, to_luastring, to_jsstring } from 'fengari-web';
import type { ScriptingAPI } from '../ScriptingAPI';
import type { IScriptingRuntime } from '../IScriptingRuntime';
import mudletColorsRaw from '../../mud/text/mudletColors.json';
import BOOTSTRAP from './bootstrap.lua?raw';

type LuaState = ReturnType<typeof lauxlib.luaL_newstate>;


export class LuaRuntime implements IScriptingRuntime {
    private L: LuaState;
    private timers: Map<number, { handle: ReturnType<typeof setTimeout>; ref: number }> = new Map();
    private aliases: Map<number, { pattern: RegExp; ref: number }> = new Map();
    private triggers: Map<number, { pattern: RegExp; ref: number }> = new Map();
    private nextTimerId = 1;
    private nextAliasId = 1;
    private nextTriggerId = 1;

    constructor(private readonly api: ScriptingAPI) {
        this.L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(this.L);
        this.exposeInternals();
        const bootstrapErr = this.exec(BOOTSTRAP, '@bootstrap');
        if (bootstrapErr) {
            console.error('[LuaRuntime] bootstrap failed:', bootstrapErr);
            this.api.printError(`[lua bootstrap error] ${bootstrapErr}`);
        }
        this.setupColorTable();
        // Sanity-check: warn if key globals are missing after bootstrap.
        lua.lua_getglobal(this.L, ls('tempTrigger'));
        if (lua.lua_type(this.L, -1) === lua.LUA_TNIL) {
            console.error('[LuaRuntime] tempTrigger is nil after bootstrap — bootstrap likely failed silently');
        }
        lua.lua_pop(this.L, 1);
    }

    // ── Public interface ──────────────────────────────────────────────────────

    load(code: string, name: string): void {
        const err = this.exec(code, `@${name}`);
        if (err) this.api.printError(`[lua error in "${name}"] ${err}`);
    }

    /** Test input against Lua-registered PCRE aliases. Sets `matches` global and calls handler on match. */
    processInput(text: string): boolean {
        for (const { pattern, ref } of this.aliases.values()) {
            const m = text.match(pattern);
            if (!m) continue;

            // matches[1] = full input, matches[2..] = captures
            this.push([text, ...m.slice(1).map(c => c ?? '')]);
            lua.lua_setglobal(this.L, ls('matches'));

            const top = lua.lua_gettop(this.L);
            lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, ref);
            const status = lua.lua_pcall(this.L, 0, 0, 0);
            if (status !== 0) {
                const err = lua.lua_tojsstring(this.L, -1);
                lua.lua_settop(this.L, top);
                this.api.printError('[lua alias error] ' + err);
            }
            return true;
        }
        return false;
    }

    /** Fire all Lua-registered temp triggers that match `line`. Sets `matches` and `line` per-trigger before calling. */
    processTrigger(line: string): void {
        lua.lua_pushstring(this.L, ls(line));
        lua.lua_setglobal(this.L, ls('line'));
        for (const { pattern, ref } of this.triggers.values()) {
            const m = line.match(pattern);
            if (!m) continue;

            this.push([line, ...m.slice(1).map(c => c ?? '')]);
            lua.lua_setglobal(this.L, ls('matches'));

            const top = lua.lua_gettop(this.L);
            lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, ref);
            const status = lua.lua_pcall(this.L, 0, 0, 0);
            if (status !== 0) {
                const err = lua.lua_tojsstring(this.L, -1);
                lua.lua_settop(this.L, top);
                this.api.printError('[lua trigger error] ' + err);
            }
        }
    }

    /** Execute `code` with the `matches` and `line` globals pre-set. Used for permanent alias/trigger execution. */
    runWithMatches(code: string, name: string, matches: string[]): void {
        this.push(matches);
        lua.lua_setglobal(this.L, ls('matches'));
        if (matches.length > 0) {
            lua.lua_pushstring(this.L, ls(matches[0]));
            lua.lua_setglobal(this.L, ls('line'));
        }
        const err = this.exec(code, `@alias:${name}`);
        if (err) this.api.printError(`[lua alias "${name}"] ${err}`);
    }

    emitEvent(event: string, args: unknown[]): void {
        const L = this.L;
        const top = lua.lua_gettop(L);

        lua.lua_getglobal(L, ls('__dispatch__'));
        if (lua.lua_type(L, -1) === lua.LUA_TNIL) {
            lua.lua_settop(L, top);
            return;
        }

        lua.lua_pushstring(L, ls(event));
        for (const arg of args) this.push(arg);

        const status = lua.lua_pcall(L, 1 + args.length, 0, 0);
        if (status !== 0) {
            console.error('[LuaRuntime] dispatch:', lua.lua_tojsstring(L, -1));
            lua.lua_settop(L, top);
        }
    }

    destroy(): void {
        for (const { handle, ref } of this.timers.values()) {
            clearTimeout(handle);
            if (this.L) lauxlib.luaL_unref(this.L, lua.LUA_REGISTRYINDEX, ref);
        }
        this.timers.clear();

        for (const { ref } of this.aliases.values()) {
            if (this.L) lauxlib.luaL_unref(this.L, lua.LUA_REGISTRYINDEX, ref);
        }
        this.aliases.clear();

        for (const { ref } of this.triggers.values()) {
            if (this.L) lauxlib.luaL_unref(this.L, lua.LUA_REGISTRYINDEX, ref);
        }
        this.triggers.clear();

        if (this.L) {
            lua.lua_close(this.L);
            this.L = null as unknown as LuaState;
        }
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    /** Execute a Lua source string. Returns an error message on failure. */
    private exec(code: string, chunkname: string): string | null {
        const L = this.L;
        const src = to_luastring(code);
        const chunk = to_luastring(chunkname);
        const loadStatus = lauxlib.luaL_loadbuffer(L, src, null, chunk);
        if (loadStatus !== 0) {
            const msg = lua.lua_tojsstring(L, -1);
            lua.lua_settop(L, 0);
            return msg;
        }
        const callStatus = lua.lua_pcall(L, 0, 0, 0);
        if (callStatus !== 0) {
            const msg = lua.lua_tojsstring(L, -1);
            lua.lua_settop(L, 0);
            return msg;
        }
        return null;
    }

    /** Register all internal JS functions that the bootstrap code references. */
    private exposeInternals(): void {
        const { api } = this;

        this.cfunction('__mudix_send__', (L) => {
            api.send(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_print__', (L) => {
            api.print(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_echo__', (L) => {
            api.echo(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_printerror__', (L) => {
            api.printError(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_cecho__', (L) => {
            api.cecho(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_decho__', (L) => {
            api.decho(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_hecho__', (L) => {
            api.hecho(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_fg__', (L) => {
            api.fg(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_bg__', (L) => {
            api.bg(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_reset_format__', (L) => {
            api.resetFormat();
            return 0;
        });

        this.cfunction('__mudix_feed_triggers__', (L) => {
            api.feedTriggers(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_temp_timer__', (L) => {
            const seconds = lua.lua_tonumber(L, 1);
            lua.lua_pushvalue(L, 2);
            const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
            const id = this.nextTimerId++;

            const handle = setTimeout(() => {
                this.timers.delete(id);
                if (!this.L) return;
                const top = lua.lua_gettop(this.L);
                lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, ref);
                lauxlib.luaL_unref(this.L, lua.LUA_REGISTRYINDEX, ref);
                const status = lua.lua_pcall(this.L, 0, 0, 0);
                if (status !== 0) {
                    const err = lua.lua_tojsstring(this.L, -1);
                    lua.lua_settop(this.L, top);
                    this.api.printError('[lua timer error] ' + err);
                }
            }, seconds * 1000);

            this.timers.set(id, { handle, ref });
            lua.lua_pushnumber(L, id);
            return 1;
        });

        this.cfunction('__mudix_kill_timer__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const timer = this.timers.get(id);
            if (timer) {
                clearTimeout(timer.handle);
                lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, timer.ref);
                this.timers.delete(id);
            }
            lua.lua_pushboolean(L, timer ? 1 : 0);
            return 1;
        });

        this.cfunction('__mudix_temp_alias__', (L) => {
            const pattern = lua.lua_tojsstring(L, 1);
            let re: RegExp;
            try {
                re = new RegExp(pattern);
            } catch {
                this.api.printError(`[lua] invalid alias pattern: ${pattern}`);
                lua.lua_pushnil(L);
                return 1;
            }
            lua.lua_pushvalue(L, 2);
            const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
            const id = this.nextAliasId++;
            this.aliases.set(id, { pattern: re, ref });
            lua.lua_pushnumber(L, id);
            return 1;
        });

        this.cfunction('__mudix_kill_alias__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const alias = this.aliases.get(id);
            if (alias) {
                lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, alias.ref);
                this.aliases.delete(id);
            }
            lua.lua_pushboolean(L, alias ? 1 : 0);
            return 1;
        });

        this.cfunction('__mudix_temp_trigger__', (L) => {
            const pattern = lua.lua_tojsstring(L, 1);
            let re: RegExp;
            try {
                re = new RegExp(pattern);
            } catch {
                this.api.printError(`[lua] invalid trigger pattern: ${pattern}`);
                lua.lua_pushnil(L);
                return 1;
            }
            lua.lua_pushvalue(L, 2);
            const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
            const id = this.nextTriggerId++;
            this.triggers.set(id, { pattern: re, ref });
            lua.lua_pushnumber(L, id);
            return 1;
        });

        this.cfunction('__mudix_kill_trigger__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const trigger = this.triggers.get(id);
            if (trigger) {
                lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, trigger.ref);
                this.triggers.delete(id);
            }
            lua.lua_pushboolean(L, trigger ? 1 : 0);
            return 1;
        });

        this.cfunction('__mudix_windows_open__', (L) => {
            const id       = lua.lua_tojsstring(L, 1);
            const kind     = this.optstring(L, 2, 'text');
            const title    = this.optstring(L, 3, id);
            const position = this.optstring(L, 4, undefined);
            api.windows.open(id, {
                kind: kind as 'text' | 'html' | 'map',
                title,
                position: position as 'right' | 'left' | 'above' | 'below' | undefined,
            });
            return 0;
        });

        this.cfunction('__mudix_windows_write__', (L) => {
            api.windows.write(lua.lua_tojsstring(L, 1), lua.lua_tojsstring(L, 2));
            return 0;
        });

        this.cfunction('__mudix_windows_clear__', (L) => {
            api.windows.clear(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_windows_set_title__', (L) => {
            api.windows.setTitle(lua.lua_tojsstring(L, 1), lua.lua_tojsstring(L, 2));
            return 0;
        });

        this.cfunction('__mudix_windows_close__', (L) => {
            api.windows.close(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_windows_has__', (L) => {
            lua.lua_pushboolean(L, api.windows.has(lua.lua_tojsstring(L, 1)) ? 1 : 0);
            return 1;
        });
    }

    /** Register a C function as a Lua global. */
    private cfunction(name: string, fn: (L: LuaState) => number): void {
        lua.lua_pushcfunction(this.L, fn);
        lua.lua_setglobal(this.L, ls(name));
    }

    /** Build the Mudlet-compatible `color_table` global: { name = {r, g, b}, ... } */
    private setupColorTable(): void {
        const colors = mudletColorsRaw as unknown as Record<string, [number, number, number]>;
        lua.lua_newtable(this.L);
        for (const [name, [r, g, b]] of Object.entries(colors)) {
            lua.lua_pushstring(this.L, ls(name));
            lua.lua_newtable(this.L);
            // {r, g, b} as 1-indexed array (Mudlet convention)
            lua.lua_pushnumber(this.L, 1); lua.lua_pushnumber(this.L, r); lua.lua_settable(this.L, -3);
            lua.lua_pushnumber(this.L, 2); lua.lua_pushnumber(this.L, g); lua.lua_settable(this.L, -3);
            lua.lua_pushnumber(this.L, 3); lua.lua_pushnumber(this.L, b); lua.lua_settable(this.L, -3);
            lua.lua_settable(this.L, -3);
        }
        lua.lua_setglobal(this.L, ls('color_table'));
    }

    /** Get an optional string argument from the Lua stack. */
    private optstring(L: LuaState, idx: number, def: string | undefined): string | undefined {
        return lua.lua_type(L, idx) === lua.LUA_TNIL ? def : lua.lua_tojsstring(L, idx);
    }

    /** Push a JS value onto the Lua stack as a native Lua value.
     *  Objects and arrays become Lua tables (not JS proxies). */
    private push(value: unknown): void {
        const L = this.L;
        if (value === null || value === undefined) {
            lua.lua_pushnil(L);
        } else if (typeof value === 'boolean') {
            lua.lua_pushboolean(L, value ? 1 : 0);
        } else if (typeof value === 'number') {
            lua.lua_pushnumber(L, value);
        } else if (typeof value === 'string') {
            lua.lua_pushstring(L, ls(value));
        } else if (Array.isArray(value)) {
            lua.lua_newtable(L);
            value.forEach((item, i) => {
                lua.lua_pushnumber(L, i + 1);
                this.push(item);
                lua.lua_settable(L, -3);
            });
        } else if (typeof value === 'object') {
            lua.lua_newtable(L);
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                lua.lua_pushstring(L, ls(k));
                this.push(v);
                lua.lua_settable(L, -3);
            }
        } else {
            lua.lua_pushnil(L);
        }
    }
}

/** Convert a JS string to a Lua string (Uint8Array). Short alias for readability. */
function ls(s: string): Uint8Array {
    return to_luastring(s);
}
