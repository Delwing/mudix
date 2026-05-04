import { lauxlib, lua, lualib, to_luastring } from 'fengari-web';
import type { ScriptingAPI } from '../ScriptingAPI';
import type { IScriptingRuntime } from '../IScriptingRuntime';
import type { ProfileVFS } from '../vfs/ProfileVFS';
import mudletColorsRaw from '../../mud/text/mudletColors.json';
import BOOTSTRAP from './bootstrap.lua?raw';
import STDLIB from './stdlib.lua?raw';
import STRING_UTILS from './StringUtils.lua?raw';
import TABLE_UTILS from './TableUtils.lua?raw';

type LuaState = ReturnType<typeof lauxlib.luaL_newstate>;

interface FileHandle {
    path: string;
    readable: boolean;
    writable: boolean;
    appendMode: boolean;
    content: string;
    position: number;
    dirty: boolean;
    closed: boolean;
}


type PendingLineTrigger = { linesAhead: number; remaining: number; code: string };

export class LuaRuntime implements IScriptingRuntime {
    private L: LuaState;
    private timers: Map<number, { handle: number; ref: number; repeat: boolean }> = new Map();
    private aliases: Map<number, { pattern: RegExp; ref: number }> = new Map();
    private triggers: Map<number, { pattern: RegExp; ref: number }> = new Map();
    private keys: Map<number, { key: string; modifiers: string[]; ref: number }> = new Map();
    private fileHandles: Map<number, FileHandle> = new Map();
    private nextTimerId = 1;
    private nextAliasId = 1;
    private nextTriggerId = 1;
    private nextKeyId = 1;
    private nextHandleId = 1;
    private currentLineIsPrompt = false;
    private pendingLineTriggers: PendingLineTrigger[] = [];

    constructor(private readonly api: ScriptingAPI, private readonly vfs: ProfileVFS | null = null) {
        this.L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(this.L);
        this.exposeInternals();
        this.exposeVFS();
        const bootstrapErr = this.exec(BOOTSTRAP, '@bootstrap');
        if (bootstrapErr) {
            lua.lua_close(this.L);
            this.L = null as unknown as LuaState;
            throw new Error(`Lua bootstrap failed: ${bootstrapErr}`);
        }
        this.setupColorTable();
        for (const [src, name] of [
            [STDLIB,       '@stdlib'],
            [STRING_UTILS, '@StringUtils'],
            [TABLE_UTILS,  '@TableUtils'],
        ] as const) {
            const err = this.exec(src, name);
            if (err) {
                console.error(`[LuaRuntime] ${name} failed:`, err);
                this.api.printError(`[lua ${name} error] ${err}`);
            }
        }
        // Verify bootstrap defined required globals.
        lua.lua_getglobal(this.L, ls('tempTrigger'));
        const bootstrapOk = lua.lua_type(this.L, -1) !== lua.LUA_TNIL;
        lua.lua_pop(this.L, 1);
        if (!bootstrapOk) {
            lua.lua_close(this.L);
            this.L = null as unknown as LuaState;
            throw new Error('Lua bootstrap did not define required globals (tempTrigger missing)');
        }
    }

    // ── Public interface ──────────────────────────────────────────────────────

    load(code: string, name: string): void {
        const err = this.exec(code, `@${name}`);
        if (err) this.api.printError(`[lua error in "${name}"] ${err}`);
    }

    setCurrentLine(line: string, isPrompt: boolean): void {
        this.currentLineIsPrompt = isPrompt;
        lua.lua_pushstring(this.L, ls(line));
        lua.lua_setglobal(this.L, ls('line'));
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

        // Drain pending tempLineTriggers first
        const stillPending: PendingLineTrigger[] = [];
        for (const t of this.pendingLineTriggers) {
            t.linesAhead--;
            if (t.linesAhead <= 0) {
                const err = this.exec(t.code, '@tempLineTrigger');
                if (err) this.api.printError('[lua tempLineTrigger] ' + err);
                this.api.flushOutput();
                t.remaining--;
                if (t.remaining > 0) {
                    t.linesAhead = 1;
                    stillPending.push(t);
                }
            } else {
                stillPending.push(t);
            }
        }
        this.pendingLineTriggers = stillPending;

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
    runWithMatches(
        code: string,
        name: string,
        matches: string[],
        multimatches?: string[][],
        namedGroups?: Record<string, string>,
    ): void {
        const L = this.L;
        // Build matches table: numeric keys 1..N plus any named capture keys
        lua.lua_newtable(L);
        matches.forEach((item, i) => {
            lua.lua_pushnumber(L, i + 1);
            lua.lua_pushstring(L, ls(item));
            lua.lua_settable(L, -3);
        });
        if (namedGroups) {
            for (const [k, v] of Object.entries(namedGroups)) {
                lua.lua_pushstring(L, ls(k));
                lua.lua_pushstring(L, ls(v));
                lua.lua_settable(L, -3);
            }
        }
        lua.lua_setglobal(L, ls('matches'));

        if (matches.length > 0) {
            lua.lua_pushstring(L, ls(matches[0]));
            lua.lua_setglobal(L, ls('line'));
        }

        if (multimatches) {
            // multimatches[1] = first condition's captures, etc. (1-indexed)
            lua.lua_newtable(L);
            multimatches.forEach((condCaptures, i) => {
                lua.lua_pushnumber(L, i + 1);
                lua.lua_newtable(L);
                condCaptures.forEach((cap, j) => {
                    lua.lua_pushnumber(L, j + 1);
                    lua.lua_pushstring(L, ls(cap));
                    lua.lua_settable(L, -3);
                });
                lua.lua_settable(L, -3);
            });
            lua.lua_setglobal(L, ls('multimatches'));
        }

        const err = this.exec(code, `@alias:${name}`);
        if (err) this.api.printError(`[lua alias "${name}"] ${err}`);
    }

    /** Evaluate a Lua code snippet in the context of `line`, returning a boolean result. */
    evalBoolean(code: string, line: string): boolean {
        const L = this.L;
        lua.lua_pushstring(L, ls(line));
        lua.lua_setglobal(L, ls('line'));

        // Try as a return expression first so single-call patterns like raiseEvent("x")
        // have their return value captured. Fall back to statement block for multi-line code.
        let src = to_luastring(`return (${code})`);
        let loadStatus = lauxlib.luaL_loadbuffer(L, src, null, to_luastring('@luaFunction'));
        if (loadStatus !== 0) {
            lua.lua_pop(L, 1);
            src = to_luastring(code);
            loadStatus = lauxlib.luaL_loadbuffer(L, src, null, to_luastring('@luaFunction'));
            if (loadStatus !== 0) {
                lua.lua_pop(L, 1);
                return false;
            }
        }

        const callStatus = lua.lua_pcall(L, 0, 1, 0);
        if (callStatus !== 0) {
            lua.lua_pop(L, 1);
            return false;
        }
        const result = Boolean(lua.lua_toboolean(L, -1));
        lua.lua_pop(L, 1);
        return result;
    }

    /** Execute a code chunk once, without match context. Used for timers and keybindings. */
    run(code: string, name: string): void {
        const err = this.exec(code, `@${name}`);
        if (err) this.api.printError(`[lua "${name}"] ${err}`);
    }

    /** Fire the first matching Lua-registered temp keybinding. Returns true if consumed. */
    processKey(event: KeyboardEvent): boolean {
        for (const { key, modifiers, ref } of this.keys.values()) {
            if (event.code !== key) continue;
            if (event.ctrlKey  !== modifiers.includes('ctrl'))  continue;
            if (event.shiftKey !== modifiers.includes('shift')) continue;
            if (event.altKey   !== modifiers.includes('alt'))   continue;
            if (event.metaKey  !== modifiers.includes('meta'))  continue;

            const top = lua.lua_gettop(this.L);
            lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, ref);
            const status = lua.lua_pcall(this.L, 0, 0, 0);
            if (status !== 0) {
                const err = lua.lua_tojsstring(this.L, -1);
                lua.lua_settop(this.L, top);
                this.api.printError('[lua key error] ' + err);
            }
            return true;
        }
        return false;
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
        for (const { handle, ref, repeat } of this.timers.values()) {
            if (repeat) clearInterval(handle);
            else clearTimeout(handle);
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

        for (const { ref } of this.keys.values()) {
            if (this.L) lauxlib.luaL_unref(this.L, lua.LUA_REGISTRYINDEX, ref);
        }
        this.keys.clear();

        for (const handle of this.fileHandles.values()) {
            if (!handle.closed) this.flushHandle(handle);
        }
        this.fileHandles.clear();

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
            const echo = lua.lua_type(L, 2) === lua.LUA_TBOOLEAN ? !!lua.lua_toboolean(L, 2) : true;
            api.send(lua.lua_tojsstring(L, 1), echo);
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

        this.cfunction('__mudix_reset_format__', () => {
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
            // LUA_TNONE=-1, LUA_TNIL=0; t3 > LUA_TNIL means arg exists and is not nil.
            // Must use Boolean() because lua_toboolean returns JS `false`, and `false !== 0` is true.
            const repeat = lua.lua_type(L, 3) > lua.LUA_TNIL && Boolean(lua.lua_toboolean(L, 3));

            const callRef = () => {
                if (!this.L) return;
                const top = lua.lua_gettop(this.L);
                lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, ref);
                const status = lua.lua_pcall(this.L, 0, 0, 0);
                if (status !== 0) {
                    const err = lua.lua_tojsstring(this.L, -1);
                    lua.lua_settop(this.L, top);
                    this.api.printError('[lua timer error] ' + err);
                }
                this.api.flushOutput();
            };

            let handle: number;
            if (repeat) {
                handle = setInterval(callRef, seconds * 1000) as unknown as number;
            } else {
                handle = setTimeout(() => {
                    this.timers.delete(id);
                    callRef();
                    lauxlib.luaL_unref(this.L, lua.LUA_REGISTRYINDEX, ref);
                }, seconds * 1000) as unknown as number;
            }

            this.timers.set(id, { handle, ref, repeat });
            lua.lua_pushnumber(L, id);
            return 1;
        });

        this.cfunction('__mudix_kill_timer__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const timer = this.timers.get(id);
            if (timer) {
                if (timer.repeat) clearInterval(timer.handle);
                else clearTimeout(timer.handle);
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

        this.cfunction('__mudix_temp_key__', (L) => {
            const key = lua.lua_tojsstring(L, 1);
            const modifiers: string[] = [];
            if (lua.lua_type(L, 2) === lua.LUA_TTABLE) {
                lua.lua_pushnil(L);
                while (lua.lua_next(L, 2) !== 0) {
                    if (lua.lua_type(L, -1) === lua.LUA_TSTRING) {
                        modifiers.push(lua.lua_tojsstring(L, -1));
                    }
                    lua.lua_pop(L, 1);
                }
            }
            lua.lua_pushvalue(L, 3);
            const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
            const id = this.nextKeyId++;
            this.keys.set(id, { key, modifiers, ref });
            lua.lua_pushnumber(L, id);
            return 1;
        });

        this.cfunction('__mudix_kill_key__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const entry = this.keys.get(id);
            if (entry) {
                lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, entry.ref);
                this.keys.delete(id);
            }
            lua.lua_pushboolean(L, entry ? 1 : 0);
            return 1;
        });

        this.cfunction('__mudix_windows_open__', (L) => {
            const id          = lua.lua_tojsstring(L, 1);
            const kind        = this.optstring(L, 2, 'text');
            const title       = this.optstring(L, 3, id);
            const position    = this.optstring(L, 4, undefined);
            // Args 5-7 are passed as strings ("true"/"false"/nil) to avoid boolean marshalling.
            const autoDockStr   = this.optstring(L, 5, undefined);
            const dockingArea   = this.optstring(L, 6, undefined);
            const ignoreHintStr = this.optstring(L, 7, undefined);
            api.windows.open(id, {
                kind:        kind        as 'text' | 'html' | 'map',
                title,
                position:    position   as 'right' | 'left' | 'above' | 'below' | undefined,
                autoDock:    autoDockStr   === undefined ? undefined : autoDockStr   === 'true',
                dockingArea: dockingArea ?? undefined,
                ignoreHint:  ignoreHintStr === 'true',
            });
            return 0;
        });

        this.cfunction('__mudix_windows_write__', (L) => {
            api.windows.write(lua.lua_tojsstring(L, 1), lua.lua_tojsstring(L, 2));
            return 0;
        });

        this.cfunction('__mudix_windows_cecho__', (L) => {
            api.windows.cecho(lua.lua_tojsstring(L, 1), lua.lua_tojsstring(L, 2));
            return 0;
        });

        this.cfunction('__mudix_windows_decho__', (L) => {
            api.windows.decho(lua.lua_tojsstring(L, 1), lua.lua_tojsstring(L, 2));
            return 0;
        });

        this.cfunction('__mudix_windows_hecho__', (L) => {
            api.windows.hecho(lua.lua_tojsstring(L, 1), lua.lua_tojsstring(L, 2));
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

        this.cfunction('__mudix_windows_hide__', (L) => {
            api.windows.hide(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_windows_show__', (L) => {
            api.windows.show(lua.lua_tojsstring(L, 1));
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

        this.cfunction('__mudix_centerview__', (L) => {
            api.centerView(lua.lua_tonumber(L, 1));
            return 0;
        });

        this.cfunction('__mudix_get_room_id_by_hash__', (L) => {
            const hash = lua.lua_tojsstring(L, 1);
            const id = api.getRoomIDbyHash(hash);
            if (id === undefined) lua.lua_pushnil(L);
            else lua.lua_pushnumber(L, id);
            return 1;
        });

        this.cfunction('__mudix_clear_window__', (L) => {
            const name = this.optstring(L, 1, undefined);
            api.clearWindow(name);
            return 0;
        });

        this.cfunction('__mudix_delete_line__', (L) => {
            const win = this.optstring(L, 1, undefined);
            api.deleteLine(win);
            return 0;
        });

        this.cfunction('__mudix_append_cmd_line__', (L) => {
            api.appendCmdLine(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_set_cmd_line__', (L) => {
            api.setCmdLine(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_get_current_line__', (_L) => {
            lua.lua_pushstring(this.L, ls(api.getCurrentLine()));
            return 1;
        });

        this.cfunction('__mudix_is_prompt__', (_L) => {
            lua.lua_pushboolean(this.L, this.currentLineIsPrompt ? 1 : 0);
            return 1;
        });

        this.cfunction('__mudix_temp_line_trigger__', (L) => {
            const from    = Math.max(1, lua.lua_tonumber(L, 1) | 0);
            const count   = Math.max(1, lua.lua_tonumber(L, 2) | 0);
            const code    = lua.lua_tojsstring(L, 3);
            this.pendingLineTriggers.push({ linesAhead: from, remaining: count, code });
            return 0;
        });

        this.cfunction('__mudix_insert_text__', (L) => {
            api.insertText(lua.lua_tojsstring(L, 1));
            return 0;
        });

        this.cfunction('__mudix_move_cursor_up__', (L) => {
            const win = this.optstring(L, 1, undefined);
            api.moveCursorUp(win);
            return 0;
        });

        this.cfunction('__mudix_move_cursor_down__', (L) => {
            const win = this.optstring(L, 1, undefined);
            api.moveCursorDown(win);
            return 0;
        });

        this.cfunction('__mudix_move_cursor__', (L) => {
            const win = lua.lua_type(L, 1) === lua.LUA_TSTRING ? lua.lua_tojsstring(L, 1) : undefined;
            const x   = lua.lua_tonumber(L, win !== undefined ? 2 : 1) | 0;
            const y   = lua.lua_tonumber(L, win !== undefined ? 3 : 2) | 0;
            api.moveCursor(win, x, y);
            return 0;
        });

        this.cfunction('__mudix_get_line_number__', (L) => {
            const win = this.optstring(L, 1, undefined);
            lua.lua_pushnumber(L, api.getLineNumber(win));
            return 1;
        });

        this.cfunction('__mudix_get_line_count__', (L) => {
            const win = this.optstring(L, 1, undefined);
            lua.lua_pushnumber(L, api.getLineCount(win));
            return 1;
        });

        this.cfunction('__mudix_get_column_number__', (L) => {
            const win = this.optstring(L, 1, undefined);
            lua.lua_pushnumber(L, api.getColumnNumber(win));
            return 1;
        });

        this.cfunction('__mudix_get_lines__', (L) => {
            const win  = lua.lua_type(L, 1) === lua.LUA_TSTRING ? lua.lua_tojsstring(L, 1) : undefined;
            const base = win !== undefined ? 2 : 1;
            const from = lua.lua_tonumber(L, base)     | 0;
            const to   = lua.lua_tonumber(L, base + 1) | 0;
            this.push(api.getLines(from, to, win));
            return 1;
        });

        this.cfunction('__mudix_select_string__', (L) => {
            // selectString([windowName], text, number_of_match)
            const nargs = lua.lua_gettop(L);
            let win: string | undefined;
            let str: string;
            let occurrence: number;
            if (nargs >= 3) {
                win        = lua.lua_tojsstring(L, 1);
                str        = lua.lua_tojsstring(L, 2);
                occurrence = (lua.lua_tonumber(L, 3) | 0) || 1;
            } else {
                str        = lua.lua_tojsstring(L, 1);
                occurrence = (lua.lua_tonumber(L, 2) | 0) || 1;
            }
            lua.lua_pushnumber(L, api.selectString(str, occurrence, win));
            return 1;
        });

        this.cfunction('__mudix_select_section__', (L) => {
            // selectSection([window,] from, length) — window is first when 3 args given
            const nargs = lua.lua_gettop(L);
            let win: string | undefined;
            let from: number;
            let length: number;
            if (nargs >= 3) {
                win    = lua.lua_tojsstring(L, 1);
                from   = lua.lua_tonumber(L, 2) | 0;
                length = lua.lua_tonumber(L, 3) | 0;
            } else {
                from   = lua.lua_tonumber(L, 1) | 0;
                length = lua.lua_tonumber(L, 2) | 0;
            }
            api.selectSection(from, length, win);
            return 0;
        });

        this.cfunction('__mudix_deselect__', (_L) => {
            api.deselect();
            return 0;
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

    // ── VFS (io / lfs / loadfile) ─────────────────────────────────────────────

    private flushHandle(handle: FileHandle): void {
        if (!handle.dirty || !handle.writable || !this.vfs) return;
        try { this.vfs.writeFile(handle.path, handle.content); } catch { /* ignore */ }
        handle.dirty = false;
    }

    private exposeVFS(): void {
        const { vfs } = this;

        // ── profile path ──────────────────────────────────────────────────────
        this.cfunction('__vfs_profile_path__', () => {
            lua.lua_pushstring(this.L, ls(vfs?.profilePath ?? ''));
            return 1;
        });

        // ── io.open ───────────────────────────────────────────────────────────
        this.cfunction('__vfs_io_open__', (L) => {
            if (!vfs) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls('no profile VFS'));
                return 2;
            }
            const path = lua.lua_tojsstring(L, 1);
            const mode = this.optstring(L, 2, 'r') ?? 'r';
            const baseMode = mode.replace('+', '').replace('b', '');
            const readable = baseMode === 'r' || mode.includes('+');
            const writable = baseMode === 'w' || baseMode === 'a' || mode.includes('+');
            const appendMode = baseMode === 'a';
            const resolved = vfs.resolvePath(path);

            let content = '';
            if (baseMode === 'r' || baseMode === 'a' || mode === 'r+') {
                if (!vfs.exists(path)) {
                    lua.lua_pushnil(L);
                    lua.lua_pushstring(L, ls(`${path}: no such file`));
                    return 2;
                }
                try { content = vfs.readFile(path); } catch (e) {
                    lua.lua_pushnil(L);
                    lua.lua_pushstring(L, ls(String(e)));
                    return 2;
                }
            }

            const id = this.nextHandleId++;
            const handle: FileHandle = {
                path: resolved,
                readable, writable, appendMode,
                content,
                position: appendMode ? content.length : 0,
                dirty: false,
                closed: false,
            };
            this.fileHandles.set(id, handle);
            lua.lua_pushnumber(L, id);
            return 1;
        });

        // ── io.close ──────────────────────────────────────────────────────────
        this.cfunction('__vfs_io_close__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const handle = this.fileHandles.get(id);
            if (!handle || handle.closed) {
                lua.lua_pushboolean(L, 1);
                return 1;
            }
            this.flushHandle(handle);
            handle.closed = true;
            this.fileHandles.delete(id);
            lua.lua_pushboolean(L, 1);
            return 1;
        });

        // ── io.read ───────────────────────────────────────────────────────────
        this.cfunction('__vfs_io_read__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const handle = this.fileHandles.get(id);
            if (!handle || handle.closed || !handle.readable) {
                lua.lua_pushnil(L);
                return 1;
            }
            const fmtType = lua.lua_type(L, 2);
            let fmt: string | number;
            if (fmtType === lua.LUA_TNUMBER) {
                fmt = lua.lua_tonumber(L, 2);
            } else if (fmtType === lua.LUA_TSTRING) {
                fmt = lua.lua_tojsstring(L, 2);
            } else {
                fmt = '*l';
            }
            const result = readFromHandle(handle, fmt);
            if (result === null) {
                lua.lua_pushnil(L);
            } else if (typeof result === 'number') {
                lua.lua_pushnumber(L, result);
            } else {
                lua.lua_pushstring(L, ls(result));
            }
            return 1;
        });

        // ── io.write ──────────────────────────────────────────────────────────
        this.cfunction('__vfs_io_write__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const handle = this.fileHandles.get(id);
            if (!handle || handle.closed || !handle.writable) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls('file not open for writing'));
                return 2;
            }
            const nargs = lua.lua_gettop(L);
            for (let i = 2; i <= nargs; i++) {
                const typ = lua.lua_type(L, i);
                const data = typ === lua.LUA_TNUMBER
                    ? String(lua.lua_tonumber(L, i))
                    : lua.lua_tojsstring(L, i);
                if (handle.appendMode) {
                    handle.content += data;
                    handle.position = handle.content.length;
                } else {
                    handle.content =
                        handle.content.slice(0, handle.position) +
                        data +
                        handle.content.slice(handle.position);
                    handle.position += data.length;
                }
                handle.dirty = true;
            }
            lua.lua_pushboolean(L, 1);
            return 1;
        });

        // ── io.seek ───────────────────────────────────────────────────────────
        this.cfunction('__vfs_io_seek__', (L) => {
            const id = lua.lua_tonumber(L, 1);
            const handle = this.fileHandles.get(id);
            if (!handle || handle.closed) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls('invalid file handle'));
                return 2;
            }
            const whence = this.optstring(L, 2, 'cur') ?? 'cur';
            const offset = lua.lua_type(L, 3) === lua.LUA_TNUMBER ? lua.lua_tonumber(L, 3) : 0;
            const len = handle.content.length;
            let newPos: number;
            if (whence === 'set') newPos = offset;
            else if (whence === 'end') newPos = len + offset;
            else newPos = handle.position + offset;
            handle.position = Math.max(0, Math.min(newPos, len));
            lua.lua_pushnumber(L, handle.position);
            return 1;
        });

        // ── lfs.mkdir ─────────────────────────────────────────────────────────
        this.cfunction('__vfs_lfs_mkdir__', (L) => {
            if (!vfs) { this.pushVfsError(L); return 2; }
            try {
                vfs.mkdir(lua.lua_tojsstring(L, 1));
                lua.lua_pushboolean(L, 1);
                return 1;
            } catch (e) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls(String(e)));
                return 2;
            }
        });

        // ── lfs.rmdir ─────────────────────────────────────────────────────────
        this.cfunction('__vfs_lfs_rmdir__', (L) => {
            if (!vfs) { this.pushVfsError(L); return 2; }
            try {
                vfs.rmdir(lua.lua_tojsstring(L, 1));
                lua.lua_pushboolean(L, 1);
                return 1;
            } catch (e) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls(String(e)));
                return 2;
            }
        });

        // ── lfs.dir ───────────────────────────────────────────────────────────
        this.cfunction('__vfs_lfs_dir__', (L) => {
            if (!vfs) { this.pushVfsError(L); return 2; }
            try {
                const entries = vfs.readdir(lua.lua_tojsstring(L, 1));
                this.push(entries);
                return 1;
            } catch (e) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls(String(e)));
                return 2;
            }
        });

        // ── lfs.attributes ────────────────────────────────────────────────────
        this.cfunction('__vfs_lfs_attr__', (L) => {
            if (!vfs) { this.pushVfsError(L); return 2; }
            const s = vfs.stat(lua.lua_tojsstring(L, 1));
            if (!s) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls('no such file or directory'));
                return 2;
            }
            this.push({
                mode: s.type === 'dir' ? 'directory' : 'file',
                size: s.size,
                modification: Math.floor(s.mtime.getTime() / 1000),
                access: Math.floor(s.atime.getTime() / 1000),
            });
            return 1;
        });

        // ── lfs.currentdir ────────────────────────────────────────────────────
        this.cfunction('__vfs_lfs_currentdir__', () => {
            lua.lua_pushstring(this.L, ls(vfs?.cwd ?? ''));
            return 1;
        });

        // ── lfs.chdir ─────────────────────────────────────────────────────────
        this.cfunction('__vfs_lfs_chdir__', (L) => {
            if (!vfs) { this.pushVfsError(L); return 2; }
            const err = vfs.chdir(lua.lua_tojsstring(L, 1));
            if (err) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls(err));
                return 2;
            }
            lua.lua_pushboolean(L, 1);
            return 1;
        });

        // ── exists / readFile (for loadfile / require) ────────────────────────
        this.cfunction('__vfs_exists__', (L) => {
            lua.lua_pushboolean(L, vfs && vfs.exists(lua.lua_tojsstring(L, 1)) ? 1 : 0);
            return 1;
        });

        this.cfunction('__vfs_read_file__', (L) => {
            if (!vfs) { this.pushVfsError(L); return 2; }
            try {
                const content = vfs.readFile(lua.lua_tojsstring(L, 1));
                lua.lua_pushstring(L, ls(content));
                return 1;
            } catch (e) {
                lua.lua_pushnil(L);
                lua.lua_pushstring(L, ls(String(e)));
                return 2;
            }
        });
    }

    private pushVfsError(L: LuaState): void {
        lua.lua_pushnil(L);
        lua.lua_pushstring(L, ls('no profile VFS'));
    }

    /** Get an optional string argument from the Lua stack. */
    private optstring(L: LuaState, idx: number, def: string | undefined): string | undefined {
        // LUA_TNONE=-1, LUA_TNIL=0; <= LUA_TNIL covers both absent and nil.
        return lua.lua_type(L, idx) <= lua.LUA_TNIL ? def : lua.lua_tojsstring(L, idx);
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

function readFromHandle(handle: FileHandle, fmt: string | number | null): string | number | null {
    const { content, position } = handle;

    if (typeof fmt === 'number') {
        if (position >= content.length) return null;
        const chunk = content.slice(position, position + fmt);
        handle.position += chunk.length;
        return chunk || null;
    }

    const f = fmt ?? '*l';

    if (f === '*l' || f === 'l') {
        if (position >= content.length) return null;
        const nlIdx = content.indexOf('\n', position);
        let line: string;
        if (nlIdx === -1) {
            line = content.slice(position);
            handle.position = content.length;
        } else {
            line = content.slice(position, nlIdx);
            handle.position = nlIdx + 1;
        }
        return line.endsWith('\r') ? line.slice(0, -1) : line;
    }

    if (f === '*L' || f === 'L') {
        if (position >= content.length) return null;
        const nlIdx = content.indexOf('\n', position);
        let line: string;
        if (nlIdx === -1) {
            line = content.slice(position);
            handle.position = content.length;
        } else {
            line = content.slice(position, nlIdx + 1);
            handle.position = nlIdx + 1;
        }
        return line;
    }

    if (f === '*a' || f === 'a') {
        const rest = content.slice(position);
        handle.position = content.length;
        return rest;
    }

    if (f === '*n' || f === 'n') {
        const m = content.slice(position).match(/^\s*([-+]?\d+\.?\d*(?:[eE][-+]?\d+)?)/);
        if (!m) return null;
        handle.position += m[0].length;
        return parseFloat(m[1]);
    }

    return null;
}
