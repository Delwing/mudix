import {Lua} from 'wasmoon-lua5.1';
import type {IScriptingRuntime} from '../IScriptingRuntime';
import type {ScriptingAPI} from '../ScriptingAPI';
import type {ProfileVFS} from '../vfs/ProfileVFS';
import UTF8 from './utf8.lua?raw';
import VFS_LUA from './VFS.lua?raw';
import LUAGLOBAL from './LuaGlobal.lua?raw';
import {setupRex} from './rex';

// All *.lua files under mudlet-lua/ are served via the VFS at /lua/<relative-path>.
// Adding a new file to the directory tree automatically makes it available to dofile().
const MUDLET_LUA_FILES = import.meta.glob('./mudlet-lua/**/*.lua', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const DOCKMAP: Record<string, string> = {
    r: 'right',
    l: 'left',
    t: 'top',
    b: 'bottom',
    main: 'main',
}


export class LuaRuntime implements IScriptingRuntime {

    // Temp alias/trigger IDs → unsub fns (engines return unsub, not numeric IDs).
    private readonly tempIds = new Map<number, () => void>();
    private nextTempId = 1;
    private _isPrompt = false;
    private currentMatches: string[] = [];

    private constructor(
        private readonly lua: Lua,
        private readonly api: ScriptingAPI,
        private vfs: ProfileVFS | null = null,
    ) {
    }

    static async create(api: ScriptingAPI, vfs: ProfileVFS | null = null): Promise<LuaRuntime> {
        const lua = await Lua.create();
        const rt = new LuaRuntime(lua, api, vfs);
        await rt.setup();
        return rt;
    }

    private async setup(): Promise<void> {
        // echo([window,] text)
        this.lua.global.set('echo', (a: string, b?: string) => {
            if (b !== undefined) {
                if (a === 'main') {
                    this.api.echo(b);
                } else {
                    this.api.echoToWindow(a, b);
                }
            } else {
                this.api.echo(a);
            }
        });

        // Format state — called by xEcho between text chunks.
        // Lua uses two calling conventions: (win, r, g, b) and (r, g, b).
        // Coerce to Number because decho/xEcho passes regex captures as Lua strings.
        this.lua.global.set('setFgColor', (winOrR: unknown, rOrG: unknown, gOrB?: unknown, b?: unknown) => {
            if (typeof winOrR === 'string') {
                this.api.setFgColor(Number(rOrG), Number(gOrB!), Number(b!), winOrR);
            } else {
                this.api.setFgColor(Number(winOrR), Number(rOrG), Number(gOrB!));
            }
        });
        this.lua.global.set('setBgColor', (winOrR: unknown, rOrG: unknown, gOrB?: unknown, b?: unknown) => {
            if (typeof winOrR === 'string') {
                this.api.setBgColor(Number(rOrG), Number(gOrB!), Number(b!), winOrR);
            } else {
                this.api.setBgColor(Number(winOrR), Number(rOrG), Number(gOrB!));
            }
        });
        // Mudlet overloads these: setBold(v) or setBold(win, v). Disambiguate by first-arg type.
        const styleSetter = (apply: (v: boolean, win?: string) => void) =>
            (a: unknown, b?: unknown) => {
                if (typeof a === 'string') apply(!!b, a);
                else apply(!!a);
            };
        this.lua.global.set('setBold',      styleSetter((v, w) => this.api.setBold(v, w)));
        this.lua.global.set('setItalics',   styleSetter((v, w) => this.api.setItalic(v, w)));
        this.lua.global.set('setUnderline', styleSetter((v, w) => this.api.setUnderline(v, w)));
        this.lua.global.set('setStrikeOut', styleSetter((v, w) => this.api.setStrikethrough(v, w)));
        this.lua.global.set('resetFormat', (_win?: string) => this.api.resetFormat(_win));
        this.lua.global.set('deselect', (_win?: string) => this.api.deselect());

        this.lua.global.set('getProfileName', () => this.api.profileName);

        // Stub primitive — Other.lua calls registerAnonymousEventHandler("*",
        // "dispatchEventToFunctions") at module load to wire up the global event
        // bridge, then immediately overwrites this with its own Lua implementation.
        // Our emitEvent calls dispatchEventToFunctions directly, so this stub
        // only needs to satisfy that one bootstrap call.
        this.lua.global.set('registerAnonymousEventHandler', () => 0);

        this.lua.global.set('raiseEvent', (event: string, ...args: unknown[]) => {
            this.emitEvent(event, args);
        });

        this.lua.global.set("windowType", (window: string) => window === "main" ? "main" : "userwindow");
        this.lua.global.set("openUserWindow", (window: string, restoreLayout: boolean = true, autoDock: boolean = true, dockingArea: string = 'r') => {
            return this.api.windows.open(window, {
                autoDock,
                dockingArea: DOCKMAP[dockingArea] ?? 'right',
                ignoreHint: restoreLayout
            });
        });
        this.lua.global.set("clearUserWindow", (window: string) => this.api.windows.clear(window));
        this.lua.global.set('clearWindow',  (name?: string) => this.api.clearWindow(name));
        this.lua.global.set('hideWindow',   (name: string)  => this.api.windows.hide(name));
        this.lua.global.set('showWindow',   (name: string)  => this.api.windows.show(name));
        this.lua.global.set('setUserWindowTitle', (name: string, title: string) => this.api.windows.setTitle(name, title));

        // ── Map view ──────────────────────────────────────────────────────────
        this.lua.global.set('centerview',      (id: number)              => this.api.centerView(id));
        this.lua.global.set('getRoomIDbyHash', (hash: string)            => this.api.getRoomIDbyHash(hash) ?? false);
        this.lua.global.set('setRoomIDbyHash', (id: number, hash: string)=> this.api.map.setRoomIDbyHash(id, hash));
        this.lua.global.set('getRoomHashByID', (id: number)              => this.api.map.getRoomHashByID(id) ?? false);

        // ── Room CRUD ─────────────────────────────────────────────────────────
        this.lua.global.set('createRoomID', ()              => this.api.map.createRoomID());
        this.lua.global.set('addRoom',      (id: number)    => this.api.map.addRoom(id));
        this.lua.global.set('deleteRoom',   (id: number)    => this.api.map.deleteRoom(id));
        this.lua.global.set('roomExists',   (id: number)    => this.api.map.roomExists(id));

        // ── Room properties ───────────────────────────────────────────────────
        this.lua.global.set('getRoomName',  (id: number)              => this.api.map.getRoomName(id) ?? false);
        this.lua.global.set('setRoomName',  (id: number, n: string)   => this.api.map.setRoomName(id, n));
        this.lua.global.set('getRoomArea',  (id: number)              => this.api.map.getRoomArea(id) ?? false);
        this.lua.global.set('setRoomArea',  (id: number, a: number)   => this.api.map.setRoomArea(id, a));
        // getRoomCoordinates returns {x,y,z} as a table; a Lua wrapper below unpacks to three values.
        this.lua.global.set('__getRoomCoordinates', (id: number)      => this.api.map.getRoomCoordinates(id));
        this.lua.global.set('setRoomCoordinates',   (id: number, x: number, y: number, z: number) => this.api.map.setRoomCoordinates(id, x, y, z));
        this.lua.global.set('getRoomsByPosition',   (areaId: number, x: number, y: number, z: number) => this.api.map.getRoomsByPosition(areaId, x, y, z));
        this.lua.global.set('getRoomEnv',   (id: number)              => this.api.map.getRoomEnv(id));
        this.lua.global.set('setRoomEnv',   (id: number, e: number)   => this.api.map.setRoomEnv(id, e));
        this.lua.global.set('getRoomChar',  (id: number)              => this.api.map.getRoomChar(id));
        this.lua.global.set('setRoomChar',  (id: number, c: string)   => this.api.map.setRoomChar(id, c));
        this.lua.global.set('getRoomUserData', (id: number, k: string)           => this.api.map.getRoomUserData(id, k));
        this.lua.global.set('setRoomUserData', (id: number, k: string, v: string)=> this.api.map.setRoomUserData(id, k, v));

        // ── Exits ─────────────────────────────────────────────────────────────
        this.lua.global.set('getRoomExits',      (id: number)                          => this.api.map.getRoomExits(id));
        this.lua.global.set('setExit',           (from: number, to: number, dir: number) => this.api.map.setExit(from, to, dir));
        this.lua.global.set('getExitStubs',      (id: number)                          => this.api.map.getExitStubs(id));
        this.lua.global.set('setExitStub',       (id: number, dir: number, set: boolean)=> this.api.map.setExitStub(id, dir, set));
        this.lua.global.set('addSpecialExit',    (from: number, to: number, cmd: string)=> this.api.map.addSpecialExit(from, to, cmd));
        this.lua.global.set('removeSpecialExit', (from: number, cmd: string)            => this.api.map.removeSpecialExit(from, cmd));
        this.lua.global.set('getSpecialExitsSwap',(id: number)                         => this.api.map.getSpecialExitsSwap(id));

        // ── Doors ─────────────────────────────────────────────────────────────
        this.lua.global.set('getDoors', (id: number)                      => this.api.map.getDoors(id));
        this.lua.global.set('setDoor',  (id: number, dir: string, val: number) => this.api.map.setDoor(id, dir, val));

        // ── Areas ─────────────────────────────────────────────────────────────
        this.lua.global.set('addAreaName',    (name: string)            => this.api.map.addAreaName(name));
        this.lua.global.set('deleteArea',     (id: number)              => this.api.map.deleteArea(id));
        this.lua.global.set('getAreaTable',   ()                        => this.api.map.getAreaTable());
        this.lua.global.set('getRoomAreaName',(areaId: number)          => this.api.map.getRoomAreaName(areaId) ?? false);
        this.lua.global.set('setAreaName',    (areaId: number, n: string)=> this.api.map.setAreaName(areaId, n));
        this.lua.global.set('getAreaRooms',   (areaId: number)          => this.api.map.getAreaRooms(areaId));

        // ── Output / format ───────────────────────────────────────────────────
        this.lua.global.set('fg',          (name: string)  => this.api.fg(name));
        this.lua.global.set('bg',          (name: string)  => this.api.bg(name));
        this.lua.global.set('insertText',  (text: string)  => this.api.insertText(text));
        this.lua.global.set('feedTriggers',(text: string)  => this.api.feedTriggers(text));
        this.lua.global.set('deleteLine',  (win?: string)  => this.api.deleteLine(win));
        this.lua.global.set('printError',  (text: string)  => this.api.printError(text));
        // echoLink primitive — always string cmd. Function-cmd conversion is done
        // by the Lua wrapper installed later in the doString block.
        this.lua.global.set('echoLink', (a: unknown, b: unknown, c: unknown, d?: unknown, e?: unknown) => {
            // Calling conventions (Mudlet-compatible):
            //   echoLink(text, cmd, tooltip [, fmt])          — 3-4 args, no window
            //   echoLink(window, text, cmd, tooltip [, fmt])  — 4-5 args, with window
            // Distinguish by typeof d: 'string' = tooltip (window form), 'boolean'|undefined = fmt
            const hasWindow = typeof d === 'string';
            const [win, text, cmd, tooltip] = hasWindow
                ? [a as string, b as string, c as string, d as string]
                : [undefined, a as string, b as string, c as string];
            this.api.echoLink(text, cmd, tooltip, win);
        });

        // Lua wrapper converts cmds/hints tables to \x01-delimited strings before calling here.
        // xEcho always passes (win, text, cmds_str, hints_str, fmt); win defaults to "main".
        this.lua.global.set('echoPopup', (win: unknown, text: unknown, cmds: unknown, hints: unknown, _fmt?: unknown) => {
            const textStr = text as string;
            if (!textStr) return;
            const split = (s: unknown) => s ? String(s).split('\x01').filter(Boolean) : [];
            const cmdsArr = split(cmds);
            const hintsArr = split(hints);
            const winStr = (win && win !== 'main') ? win as string : undefined;
            this.api.echoPopup(textStr, cmdsArr, hintsArr, winStr);
        });

        this.lua.global.set('openWebPage', (url: string) => { window.open(url, '_blank'); });

        // ── Send ─────────────────────────────────────────────────────────────
        this.lua.global.set('send', (text: string, echo?: boolean) => this.api.send(text, echo ?? true));

        // ── Command bar ───────────────────────────────────────────────────────
        this.lua.global.set('appendCmdLine', (text: string) => this.api.appendCmdLine(text));
        this.lua.global.set('printCmdLine',  (text: string) => this.api.printCmdLine(text));

        // ── Line / cursor inspection ──────────────────────────────────────────
        this.lua.global.set('isPrompt',       ()            => this._isPrompt);
        this.lua.global.set('getCurrentLine', (win?: string)=> this.api.getCurrentLine(win));
        this.lua.global.set('getLineNumber',  (win?: string)=> this.api.getLineNumber(win));
        this.lua.global.set('getLineCount',   (win?: string)=> this.api.getLineCount(win));
        this.lua.global.set('getColumnNumber',(win?: string)=> this.api.getColumnNumber(win));
        this.lua.global.set('getLines', (a: string | number, b: number, c?: number) => {
            // getLines([window,] from, to)
            return c !== undefined ? this.api.getLines(b, c, a as string) : this.api.getLines(a as number, b);
        });
        this.lua.global.set('moveCursorUp',   (win?: string)=> this.api.moveCursorUp(win));
        this.lua.global.set('moveCursorDown',  (win?: string)=> this.api.moveCursorDown(win));
        this.lua.global.set('moveCursorEnd',  (win?: string)=> this.api.moveCursorEnd(win));
        this.lua.global.set('moveCursor', (a: string | number, b: number, c?: number) => {
            // moveCursor([window,] x, y)
            c !== undefined ? this.api.moveCursor(a as string, b, c) : this.api.moveCursor(undefined, a as number, b);
        });
        this.lua.global.set('selectString', (a: string, b: string | number, c?: number) => {
            // selectString([window,] text, occurrence)
            return c !== undefined ? this.api.selectString(b as string, c, a) : this.api.selectString(a, b as number);
        });
        this.lua.global.set('selectSection', (a: string | number, b: number, c?: number) => {
            // selectSection([window,] from, length)
            c !== undefined ? this.api.selectSection(b, c, a as string) : this.api.selectSection(a as number, b);
        });

        // ── Temp callbacks (timer/alias/trigger/key) ──────────────────────────
        // Mudlet user code passes Lua functions to these primitives. Calling a
        // wasmoon Lua-function proxy back from a JS callback fails inside the
        // WASM bridge ("attempt to call a number value"), so the Lua wrappers
        // installed below stash the function in a Lua-side registry and pass a
        // numeric callback ID to JS instead. JS dispatches by ID via doStringSync.
        const dispatchCb = (cbId: number): void => {
            try {
                this.lua.doStringSync(`__mudix_dispatch_cb(${cbId})`);
            } catch (e) {
                this.api.printError(`[callback] ${e instanceof Error ? e.message : String(e)}`);
            }
        };
        const releaseCb = (cbId: number): void => {
            try { this.lua.doStringSync(`__mudix_unregister_cb(${cbId})`); } catch {}
        };

        // ── Timers ────────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempTimer', (seconds: number, cbId: number, repeating?: boolean) => {
            const isRepeat = repeating ?? false;
            return this.api.timers.addTemp(seconds, () => {
                dispatchCb(cbId);
                if (!isRepeat) releaseCb(cbId);
                this.api.flushOutput();
            }, isRepeat);
        });
        this.lua.global.set('killTimer', (id: number) => this.api.timers.killTimer(id));

        // ── Aliases ───────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempAlias', (pattern: string, cbId: number) => {
            const id = this.nextTempId++;
            const unsub = this.api.aliases.addTemp(pattern, (m: RegExpMatchArray) => {
                this.setMatches(Array.from(m));
                dispatchCb(cbId);
                this.api.flushOutput();
            });
            this.tempIds.set(id, () => { unsub(); releaseCb(cbId); });
            return id;
        });
        this.lua.global.set('killAlias', (id: number) => {
            const unsub = this.tempIds.get(id);
            if (!unsub) return false;
            unsub(); this.tempIds.delete(id); return true;
        });

        // ── Triggers ──────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempTrigger', (pattern: string, cbId: number) => {
            const id = this.nextTempId++;
            const unsub = this.api.triggers.addTemp(pattern, (m: RegExpMatchArray) => {
                this.setMatches(Array.from(m));
                dispatchCb(cbId);
                this.api.flushOutput();
            });
            this.tempIds.set(id, () => { unsub(); releaseCb(cbId); });
            return id;
        });
        this.lua.global.set('killTrigger', (id: number) => {
            const unsub = this.tempIds.get(id);
            if (!unsub) return false;
            unsub(); this.tempIds.delete(id); return true;
        });

        // ── Keys ──────────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempKey', (modifier: number, key: string | number, cbId: number) => {
            const mods: string[] = [];
            if (modifier & 0x4000000) mods.push('ctrl');
            if (modifier & 0x2000000) mods.push('shift');
            if (modifier & 0x8000000) mods.push('alt');
            if (modifier & 0x10000000) mods.push('meta');
            const keyStr = typeof key === 'string' ? key : String(key);
            return this.api.keys.addTemp(keyStr, mods, () => {
                dispatchCb(cbId);
                this.api.flushOutput();
            });
        });
        this.lua.global.set('killKey', (id: number) => this.api.keys.killKey(id));

        // ── Error / debug ─────────────────────────────────────────────────────
        // showHandlerError is called by Other.lua's dispatchEventToFunctions when
        // a handler throws — it's a C++ function in Mudlet, bridged here.
        this.lua.global.set('showHandlerError', (event: string, error: string) => {
            this.api.printError(`[event "${event}"] ${error}`);
        });
        this.lua.global.set('debugc', (...args: unknown[]) => {
            console.debug('[Lua]', ...args.map(a => String(a)));
        });
        this.lua.global.set('errorc', (...args: unknown[]) => {
            this.api.printError(args.map(a => String(a)).join(' '));
        });

        // ── Send / alias ──────────────────────────────────────────────────────
        this.lua.global.set('expandAlias', (text: string, echo?: boolean) => {
            this.api.expandAlias(text, echo ?? true);
            this.api.flushOutput();
        });
        this.lua.global.set('sendCmdLine', (text: string) => {
            this.api.send(text, true);
        });

        // ── Text manipulation ─────────────────────────────────────────────────
        this.lua.global.set('replace', (a: unknown, b?: unknown) => {
            // replace([window,] newText)
            const hasWindow = b !== undefined;
            const [win, text] = hasWindow
                ? [a as string, b as string]
                : [undefined, a as string];
            this.api.replace(text, win);
        });
        this.lua.global.set('selectCaptureGroup', (groupOrName: number | string) => {
            if (typeof groupOrName === 'number') {
                const idx = groupOrName - 1; // Lua 1-indexed → JS 0-indexed
                if (idx < 0 || idx >= this.currentMatches.length) return -1;
                const text = this.currentMatches[idx];
                return this.api.selectString(text, 1);
            }
            // TODO: named capture group lookup (requires storing namedGroups from runWithMatches)
            return -1;
        });

        // ── Network ───────────────────────────────────────────────────────────
        this.lua.global.set('getNetworkLatency', () => this.api.getNetworkLatency() / 1000);

        // ── Window geometry ───────────────────────────────────────────────────
        // Returns [w, h] from JS; a Lua wrapper below unpacks it to two values.
        this.lua.global.set('__getMainWindowSize', () => this.api.getMainWindowSize());

        // ── Timers (extended) ─────────────────────────────────────────────────
        // TODO: implement remainingTime — requires TimerEngine to track scheduled fire times
        this.lua.global.set('remainingTime', (_id: unknown) => -1);

        await this.lua.doString(`
matches = {}; multimatches = {}
function getRoomCoordinates(id)
    local t = __getRoomCoordinates(id)
    if t then return t[1], t[2], t[3] end
    return false
end

function getMainWindowSize()
    local t = __getMainWindowSize()
    return t[1], t[2]
end

-- Callback registry: stores Lua functions handed to tempTimer/Alias/Trigger/Key
-- so JS only ever sees a numeric ID. JS invokes __mudix_dispatch_cb(id) via
-- doStringSync, sidestepping wasmoon's broken Lua-function-from-JS proxy.
__mudix_cb = {}
__mudix_cb_next = 0
function __mudix_register_cb(fn)
    __mudix_cb_next = __mudix_cb_next + 1
    __mudix_cb[__mudix_cb_next] = fn
    return __mudix_cb_next
end
function __mudix_unregister_cb(id) __mudix_cb[id] = nil end
function __mudix_dispatch_cb(id)
    local fn = __mudix_cb[id]
    if fn then return fn() end
end

-- JS event bridge. emitEvent() sets __mudix_evt_name + __mudix_evt_args
-- (a JS array, so its keys are 0-indexed) and runs this dispatcher.
function __mudix_dispatch_event()
    local event = __mudix_evt_name
    local raw = __mudix_evt_args
    -- JS arrays push as Lua tables keyed 0..n-1; rebuild as a 1-indexed sequence.
    local args = {}
    if type(raw) == 'table' then
        local i = 0
        while raw[i] ~= nil do
            args[#args + 1] = raw[i]
            i = i + 1
        end
        -- Fall back to ipairs in case wasmoon ever pushes 1-indexed.
        if #args == 0 then for _, v in ipairs(raw) do args[#args + 1] = v end end
    end
    if type(_G[event]) == 'function' then
        local ok, err = pcall(_G[event], unpack(args))
        if not ok and type(showHandlerError) == 'function' then showHandlerError(event, err) end
    end
    if type(dispatchEventToFunctions) == 'function' then
        dispatchEventToFunctions(event, unpack(args))
    end
end

do
    local _raw = __mudix_tempTimer
    function tempTimer(seconds, fn, repeating)
        if type(fn) ~= 'function' then
            error("tempTimer: bad argument #2 (function expected, got " .. type(fn) .. ")")
        end
        return _raw(seconds, __mudix_register_cb(fn), repeating or false)
    end
end

do
    local _raw = __mudix_tempAlias
    function tempAlias(pattern, fn)
        if type(fn) ~= 'function' then
            error("tempAlias: bad argument #2 (function expected, got " .. type(fn) .. ")")
        end
        return _raw(pattern, __mudix_register_cb(fn))
    end
end

do
    local _raw = __mudix_tempTrigger
    function tempTrigger(pattern, fn)
        if type(fn) ~= 'function' then
            error("tempTrigger: bad argument #2 (function expected, got " .. type(fn) .. ")")
        end
        return _raw(pattern, __mudix_register_cb(fn))
    end
end

do
    local _raw = __mudix_tempKey
    function tempKey(modifier, key, fn)
        if type(fn) ~= 'function' then
            error("tempKey: bad argument #3 (function expected, got " .. type(fn) .. ")")
        end
        return _raw(modifier, key, __mudix_register_cb(fn))
    end
end

-- echoLink: convert Lua function cmd → stored ref + string command.
do
    local _fns = {}
    local _id  = 0
    local _raw = echoLink
    function __mudix_call_link(id) _fns[id]() end
    echoLink = function(...)
        local args = {...}
        local n = #args
        local ci = (n >= 4 and type(args[4]) == 'string') and 3 or 2
        if type(args[ci]) == 'function' then
            _id = _id + 1
            local id = _id
            _fns[id] = args[ci]
            args[ci] = '__mudix_call_link(' .. id .. ')'
        end
        return _raw(unpack(args))
    end
end

-- echoPopup: xEcho passes cmds/hints as Lua tables.  wasmoon's JS proxy
-- for LuaTable doesn't support reliable numeric-key iteration from JS, so
-- flatten the tables to \x01-delimited strings here in Lua (where ipairs
-- is trivial) and let the JS binding split them.
do
    local _raw = echoPopup
    local SEP = '\\1'
    echoPopup = function(win, v, cmds, hints, fmt)
        if not v or v == '' then return end
        local cs, hs = {}, {}
        if type(cmds) == 'table' then
            for _, c in ipairs(cmds) do cs[#cs+1] = tostring(c) end
        end
        if type(hints) == 'table' then
            for _, h in ipairs(hints) do hs[#hs+1] = tostring(h) end
        end
        return _raw(win, v, table.concat(cs, SEP), table.concat(hs, SEP), fmt)
    end
end
`);
        await setupRex(this.lua);

        // Wrap all user-code execution in xpcall so Lua errors are caught before
        // they reach wasmoon's coroutine top-level. An uncaught error kills the
        // wasmoon thread; subsequent run() calls then fail with "cannot resume
        // non-suspended coroutine" instead of the original error.
        await this.lua.doString(`
            function __exec(code, name)
                __exec_err = nil
                __exec_result = nil
                local fn, compile_err = loadstring(code, "@" .. name)
                if not fn then
                    __exec_err = compile_err
                    return
                end
                local ok, r = xpcall(fn, function(e)
                    return debug.traceback(e, 2)
                end)
                if ok then
                    __exec_result = r
                else
                    __exec_err = r
                end
            end
        `);

        await this.execModule(UTF8, 'utf8', 'utf8');

        // Built-in Lua files served read-only via the VFS at /lua/<relative-path>.
        // Derived from mudlet-lua/ directory; keys mirror the paths LuaGlobal.lua
        // constructs with luaGlobalPath="/lua" (e.g. /lua/3rdparty/Inspect.lua).
        const builtins = new Map(
            Object.entries(MUDLET_LUA_FILES).map(([p, src]) => {
                const rel = p.slice('./mudlet-lua/'.length);
                return [`/lua/${rel}`, src] as [string, string];
            })
        );
        this.setupVFS(this.vfs, builtins);
        await this.exec(VFS_LUA, 'VFS');
        await this.exec(`
luaGlobalPath = "/lua"
mudlet = {}
toNativeSeparators = function(p) return p end
`, 'lua-globals-setup');
        await this.exec(LUAGLOBAL, 'LuaGlobal');
    }

    // ── VFS bridge ───────────────────────────────────────────────────────────

    private setupVFS(vfs: ProfileVFS | null, builtins = new Map<string, string>()): void {
        let nextId = 1;
        let lastError = '';

        interface Handle {
            path: string;
            mode: string;
            content: string;
            pos: number;
            dirty: boolean;
        }

        const handles = new Map<number, Handle>();

        this.lua.global.set('__vfs_err__', () => lastError);
        this.lua.global.set('__vfs_exists__', (path: string) =>
            builtins.has(path) || (vfs ? vfs.exists(path) : false));
        this.lua.global.set('__vfs_profile_dir__', () => vfs?.profilePath ?? '/profiles/default');

        this.lua.global.set('__vfs_io_open__', (filename: string, mode: string): number | null => {
            try {
                const m = (mode ?? 'r').replace(/b/g, '');
                let content = '';
                let resolvedPath = filename;
                let dirty = false;

                if (builtins.has(filename)) {
                    if (m !== 'r') { lastError = `cannot open '${filename}': read-only`; return null; }
                    content = builtins.get(filename)!;
                } else if (vfs) {
                    resolvedPath = vfs.resolvePath(filename);
                    if (m === 'r' || m === 'r+') {
                        if (!vfs.exists(filename)) {
                            lastError = `cannot open '${filename}': No such file or directory`;
                            return null;
                        }
                        content = vfs.readFile(filename);
                    } else if (m === 'a' || m === 'a+') {
                        if (vfs.exists(filename)) content = vfs.readFile(filename);
                    }
                    dirty = m === 'w' || m === 'w+';
                } else {
                    lastError = `cannot open '${filename}': No such file or directory`;
                    return null;
                }

                const id = nextId++;
                handles.set(id, {
                    path: resolvedPath,
                    mode: m,
                    content,
                    pos: m.startsWith('a') ? content.length : 0,
                    dirty,
                });
                return id;
            } catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                return null;
            }
        });

        this.lua.global.set('__vfs_io_read__', (id: number, fmt: string | number): string | number | null => {
            const h = handles.get(id);
            if (!h) { lastError = 'invalid file handle'; return null; }
            if (h.mode === 'w' || h.mode === 'a') { lastError = 'file is write-only'; return null; }

            if (typeof fmt === 'number') {
                if (fmt === 0) return '';
                const chunk = h.content.substring(h.pos, h.pos + fmt);
                if (chunk.length === 0) return null;
                h.pos += chunk.length;
                return chunk;
            }

            const f = (fmt ?? '*l').toString().replace(/^\*/, '');

            if (f === 'l' || f === 'L') {
                if (h.pos >= h.content.length) return null;
                const nl = h.content.indexOf('\n', h.pos);
                if (nl === -1) {
                    const line = h.content.substring(h.pos);
                    h.pos = h.content.length;
                    return f === 'L' ? line + '\n' : line;
                }
                const line = h.content.substring(h.pos, nl);
                h.pos = nl + 1;
                return f === 'L' ? line + '\n' : line;
            }
            if (f === 'a') {
                const rest = h.content.substring(h.pos);
                h.pos = h.content.length;
                return rest;
            }
            if (f === 'n') {
                const m = h.content.substring(h.pos).match(/^\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
                if (!m) return null;
                h.pos += m[0].length;
                return parseFloat(m[1]);
            }
            return null;
        });

        this.lua.global.set('__vfs_io_write__', (id: number, data: string): string | null => {
            const h = handles.get(id);
            if (!h) return 'invalid file handle';
            if (h.mode === 'r') return 'file is read-only';
            if (h.mode === 'a' || h.mode === 'a+') {
                h.content += data;
            } else {
                h.content = h.content.substring(0, h.pos) + data + h.content.substring(h.pos + data.length);
                h.pos += data.length;
            }
            h.dirty = true;
            return null;
        });

        this.lua.global.set('__vfs_io_seek__', (id: number, whence: string, offset: number): number | null => {
            const h = handles.get(id);
            if (!h) { lastError = 'invalid file handle'; return null; }
            const o = offset ?? 0;
            let newPos: number;
            if ((whence ?? 'cur') === 'set') newPos = o;
            else if ((whence ?? 'cur') === 'cur') newPos = h.pos + o;
            else if (whence === 'end') newPos = h.content.length + o;
            else { lastError = 'invalid whence'; return null; }
            h.pos = Math.max(0, Math.min(newPos, h.content.length));
            return h.pos;
        });

        this.lua.global.set('__vfs_io_close__', (id: number): string | null => {
            const h = handles.get(id);
            if (!h) return 'invalid file handle';
            try {
                if (h.dirty && vfs) vfs.writeFile(h.path, h.content);
                handles.delete(id);
                return null;
            } catch (e) {
                handles.delete(id);
                return e instanceof Error ? e.message : String(e);
            }
        });

        this.lua.global.set('__vfs_os_remove__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            try { vfs.deleteFile(path); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_chdir__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            const err = vfs.chdir(path);
            if (err) { lastError = err; return false; }
            return true;
        });

        this.lua.global.set('__vfs_lfs_currentdir__', () => vfs?.cwd ?? '/');

        this.lua.global.set('__vfs_lfs_mkdir__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            try { vfs.mkdir(path); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_rmdir__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            try { vfs.rmdir(path); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_dir__', (path: string): string[] | null => {
            if (!vfs) { lastError = 'no profile VFS'; return null; }
            try {
                return ['.', '..', ...vfs.readdir(path)];
            } catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                return null;
            }
        });

        this.lua.global.set('__vfs_lfs_stat__', (path: string): object | null => {
            const s = vfs?.stat(path) ?? null;
            if (!s) return null;
            return {
                type: s.type,
                size: s.size,
                modification: Math.floor(s.mtime.getTime() / 1000),
                access: Math.floor(s.atime.getTime() / 1000),
            };
        });
    }

    // ── IScriptingRuntime ─────────────────────────────────────────────────────

    async load(code: string, name: string): Promise<void> {
        await this.exec(code, name);
    }

    async run(code: string, name: string): Promise<void> {
        await this.exec(code, name);
    }

    async runWithMatches(
        code: string,
        name: string,
        matches: string[],
        multimatches?: string[][],
        _namedGroups?: Record<string, string>,
    ): Promise<void> {
        this.currentMatches = matches;
        this.setMatches(matches, multimatches);
        await this.exec(code, name);
    }

    // wasmoon's pushTable iterates Object.keys(arr) and uses the keys as
    // numeric Lua indices — so a normal JS array becomes a 0-indexed Lua
    // table. Object.keys skips holes, so a sparse array with index 0 empty
    // pushes as a 1-indexed Lua sequence (which Mudlet user code expects:
    // matches[1] = full match, matches[2] = first capture).
    private setMatches(matches: string[], multimatches?: string[][]): void {
        const oneIndexed = (arr: string[]): string[] => {
            const t: string[] = [];
            for (let i = 0; i < arr.length; i++) t[i + 1] = arr[i];
            return t;
        };
        this.lua.global.set('matches', oneIndexed(matches));
        const mm: string[][] = [];
        if (multimatches) for (let i = 0; i < multimatches.length; i++) mm[i + 1] = oneIndexed(multimatches[i]);
        this.lua.global.set('multimatches', mm);
    }

    private async exec(code: string, name: string): Promise<void> {
        this.lua.global.set('__exec_code', code);
        this.lua.global.set('__exec_name', name);
        this.lua.global.loadString('__exec(__exec_code, __exec_name)', '@exec');
        await this.lua.global.run();
        const err = this.lua.global.get('__exec_err') as string | null | undefined;
        if (err != null) throw new Error(err);
    }

    private async execModule(code: string, name: string, globalName: string): Promise<void> {
        await this.exec(code, name);
        const result = this.lua.global.get('__exec_result');
        if (result !== undefined && result !== null) this.lua.global.set(globalName, result);
    }

    emitEvent(event: string, args: unknown[]): void {
        // Calling Lua functions through wasmoon's JS proxy is unreliable
        // (intermittent "attempt to call a number value" / typed-array errors),
        // so dispatch via doStringSync instead. Args travel through a global
        // so we don't have to escape arbitrary values into the Lua source.
        try {
            this.lua.global.set('__mudix_evt_args', args);
            this.lua.global.set('__mudix_evt_name', event);
            this.lua.doStringSync('__mudix_dispatch_event()');
        } catch (err) {
            this.api.printError(`[event "${event}"] ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    setCurrentLine(line: string, isPrompt: boolean): void {
        this.lua.global.set('line', line);
        this._isPrompt = isPrompt;
    }

    destroy(): void {
        this.lua.global.close();
    }
}
