import {Lua} from 'wasmoon-lua5.1';
import type {IScriptingRuntime} from '../IScriptingRuntime';
import type {ScriptingAPI} from '../ScriptingAPI';
import type {ProfileVFS} from '../vfs/ProfileVFS';
import UTF8 from './utf8.lua?raw';
import VFS_LUA from './VFS.lua?raw';
import LUAGLOBAL from './LuaGlobal.lua?raw';
import BRIDGE_LUA from './Bridge.lua?raw';
import EXEC_LUA from './Exec.lua?raw';
import LUA_GLOBAL_SETUP from './LuaGlobalSetup.lua?raw';
import LUASQL_LUA from './Luasql.lua?raw';
import {setupRex} from './rex';
import {getSqliteClient, sqliteReady} from '../../db/sqliteClient';
import {QT_CURSOR_TO_CSS} from '../../ui/labels/cursorShapes';

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
    private _denyCurrentSend = false;

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
        // echo([window,] text). Mudlet routes echo to labels when the target
        // name is a label — its HTML is replaced (not appended to).
        this.lua.global.set('echo', (a: string, b?: string) => {
            if (b !== undefined) {
                if (a === 'main') {
                    this.api.echo(b);
                } else if (this.api.labels.has(a)) {
                    this.api.labels.setHtml(a, b);
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

        // raiseEvent runs every handler synchronously. JS is single-threaded
        // so handler-A-before-handler-B ordering falls out of the call stack.
        this.lua.global.set('raiseEvent', (event: string, ...args: unknown[]) => {
            this.emitEvent(event, args);
        });

        this.lua.global.set("windowType", (window: string) => {
            if (window === "main") return "main";
            if (this.api.labels.has(window)) return "label";
            if (this.api.windows.isMiniConsole(window)) return "miniconsole";
            if (this.api.windows.has(window)) return "userwindow";
            return null;
        });
        this.lua.global.set("openUserWindow", (window: string, restoreLayout: boolean = true, autoDock: boolean = true, dockingArea: string = 'r') => {
            return this.api.windows.open(window, {
                autoDock,
                dockingArea: DOCKMAP[dockingArea] ?? 'right',
                ignoreHint: restoreLayout
            });
        });
        this.lua.global.set("clearUserWindow", (window: string) => this.api.windows.clear(window));
        // createMiniConsole has two calling conventions:
        //   createMiniConsole(name, x, y, w, h)              — 5 args, parent defaults to main
        //   createMiniConsole(parent, name, x, y, w, h)      — 6 args, miniconsole inside a userwindow
        // Number() coerces because regex-capture args arrive as Lua strings.
        this.lua.global.set('createMiniConsole', (a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f?: unknown) => {
            const hasParent = f !== undefined;
            const [parent, name, x, y, w, h] = hasParent
                ? [a as string, b, c, d, e, f]
                : [undefined, a, b, c, d, e];
            return this.api.createMiniConsole(
                String(name ?? ''),
                Number(x), Number(y),
                Number(w), Number(h),
                parent,
            );
        });
        this.lua.global.set('clearWindow',  (name?: string) => this.api.clearWindow(name));
        // hide/show/move/resize work on both labels and userwindows. Labels take
        // precedence: name uniqueness is shared across them, but createLabel can
        // race with openUserWindow under the same string.
        this.lua.global.set('hideWindow', (name: string) => {
            if (this.api.labels.has(name)) this.api.labels.hide(name);
            else this.api.windows.hide(name);
        });
        this.lua.global.set('showWindow', (name: string) => {
            if (this.api.labels.has(name)) this.api.labels.show(name);
            else this.api.windows.show(name);
        });
        this.lua.global.set('moveWindow', (name: string, x: unknown, y: unknown) => {
            const xn = Number(x), yn = Number(y);
            if (this.api.labels.has(name)) this.api.labels.move(name, xn, yn);
            else if (this.api.windows.has(name)) this.api.windows.move(name, xn, yn);
        });
        this.lua.global.set('resizeWindow', (name: string, w: unknown, h: unknown) => {
            const wn = Number(w), hn = Number(h);
            if (this.api.labels.has(name)) this.api.labels.resize(name, wn, hn);
            else if (this.api.windows.has(name)) this.api.windows.resize(name, wn, hn);
        });
        this.lua.global.set('setUserWindowTitle', (name: string, title: string) => this.api.windows.setTitle(name, title));

        // setBackgroundColor(name, r, g, b [, a]) — labels only for now.
        // Numeric coercion because trigger captures arrive as strings.
        this.lua.global.set('setBackgroundColor', (name: unknown, r: unknown, g: unknown, b: unknown, a?: unknown) => {
            if (typeof name !== 'string') return;
            if (!this.api.labels.has(name)) return;
            this.api.labels.setBackgroundColor(
                name,
                Number(r), Number(g), Number(b),
                a !== undefined ? Number(a) : 255,
            );
        });

        // ── Labels ────────────────────────────────────────────────────────────
        // createLabel([window,] name, x, y, w, h, fillBackground [, clickThrough]).
        // Mudlet detects the optional window arg by counting; we use the second-
        // arg type because (string,string) ⇒ window form and (string,number) ⇒
        // no window. fillBackground/clickThrough accept booleans or 0/1.
        this.lua.global.set('createLabel', (...args: unknown[]) => {
            const hasWindow = typeof args[0] === 'string' && typeof args[1] === 'string';
            const window = hasWindow ? (args[0] as string) : 'main';
            const i = hasWindow ? 1 : 0;
            const name = args[i] as string;
            return this.api.labels.create(name, {
                parent: window === 'main' ? 'main' : window,
                x: Number(args[i + 1]), y: Number(args[i + 2]),
                width: Number(args[i + 3]), height: Number(args[i + 4]),
                fillBackground: !!args[i + 5],
                clickThrough: !!args[i + 6],
            });
        });
        this.lua.global.set('deleteLabel', (name: string) => this.api.labels.destroy(name));
        // setLabelStyleSheet(name, css) — Qt-style CSS string, applied to the
        // label DIV. Used by Mudlet's setGaugeStyleSheet via the _back/_front/_text
        // labels.
        this.lua.global.set('setLabelStyleSheet', (name: string, css: string) => {
            this.api.labels.setStyleSheet(name, css == null ? '' : String(css));
        });
        // setLabelClickCallback(name, fn). The fn is registered via the Lua-side
        // cb registry (Bridge.lua wrapper); JS only sees a numeric ID. Replacing
        // the callback leaks the prior cb id in the Lua registry — bounded and
        // acceptable for now.
        this.lua.global.set('__mudix_setLabelClickCallback', (name: string, cbId: number) => {
            return this.api.labels.setClickCallback(name, () => {
                this.dispatchCb(cbId, `label "${name}"`);
            });
        });
        // setLabelToolTip(name, text [, duration]) — duration arg is accepted for
        // Mudlet compatibility but ignored: the title attribute has no per-tooltip
        // duration. resetLabelToolTip clears it.
        this.lua.global.set('setLabelToolTip', (name: unknown, text?: unknown, _duration?: unknown) => {
            if (typeof name !== 'string') return;
            this.api.labels.setTooltip(name, text == null ? undefined : String(text));
        });
        this.lua.global.set('resetLabelToolTip', (name: unknown) => {
            if (typeof name !== 'string') return;
            this.api.labels.setTooltip(name, undefined);
        });
        // Runtime clickthrough toggle. Flips pointer-events live; the click
        // handler set via setLabelClickCallback stays installed either way.
        this.lua.global.set('enableClickthrough', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.setClickThrough(name, true);
        });
        this.lua.global.set('disableClickthrough', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.setClickThrough(name, false);
        });
        // Z-order. Each call bumps the label past every other label raised so
        // far (or below every other lowered label). No Mudlet-side global
        // ordering — labels not raised/lowered float at z-index auto.
        this.lua.global.set('raiseLabel', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.raise(name);
        });
        this.lua.global.set('lowerLabel', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.lower(name);
        });
        // setLabelCursor(name, shapeInt). The Mudlet GUIUtils.lua wrapper
        // converts string shape names → ints via mudlet.cursor before calling
        // here, so we only handle the integer case. shape -1 ('Reset') clears.
        this.lua.global.set('setLabelCursor', (name: unknown, shape: unknown) => {
            if (typeof name !== 'string') return;
            const n = Number(shape);
            if (n === -1 || Number.isNaN(n)) {
                this.api.labels.setCursor(name, undefined);
                return;
            }
            this.api.labels.setCursor(name, QT_CURSOR_TO_CSS[n] ?? 'default');
        });
        this.lua.global.set('resetLabelCursor', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.setCursor(name, undefined);
        });

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
        this.lua.global.set('send', (text: string, echo?: boolean) => { this.api.send(text, echo ?? true); });
        // Cancels the in-flight sysDataSendRequest dispatch. Only meaningful while
        // a sysDataSendRequest handler is on the stack — flag is reset before each send.
        this.lua.global.set('denyCurrentSend', () => { this._denyCurrentSend = true; });

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
        // numeric callback ID to JS instead.
        const dispatchCb = (cbId: number, label: string): void => this.dispatchCb(cbId, label);
        const releaseCb = (cbId: number): void => {
            try { this.lua.doStringSync(`__mudix_unregister_cb(${cbId})`); } catch {}
        };

        // ── Timers ────────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempTimer', (seconds: number, cbId: number, repeating?: boolean) => {
            const isRepeat = repeating ?? false;
            return this.api.timers.addTemp(seconds, () => {
                dispatchCb(cbId, 'tempTimer');
                if (!isRepeat) releaseCb(cbId);
            }, isRepeat);
        });
        this.lua.global.set('killTimer', (id: number) => this.api.timers.killTimer(id));

        // ── Aliases ───────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempAlias', (pattern: string, cbId: number) => {
            const id = this.nextTempId++;
            const unsub = this.api.aliases.addTemp(pattern, (m: RegExpMatchArray) => {
                this.setMatches(Array.from(m));
                dispatchCb(cbId, 'tempAlias');
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
                dispatchCb(cbId, 'tempTrigger');
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
                dispatchCb(cbId, 'tempKey');
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
            void this.api.send(text, true);
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

        // Bootstrap chunks run sync — none of them yield. setupRex needs an
        // await for one-time PCRE wasm init; sqliteReady gates the SQL bridge
        // until the sqlite module has finished loading.
        this.lua.doStringSync(BRIDGE_LUA);
        await setupRex(this.lua);
        this.lua.doStringSync(EXEC_LUA);
        this.execModule(UTF8, 'utf8', 'utf8');

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
        this.exec(VFS_LUA, 'VFS');
        this.exec(LUA_GLOBAL_SETUP, 'lua-globals-setup');
        await sqliteReady;
        this.setupSqlBridge();
        this.exec(LUASQL_LUA, 'Luasql');
        this.exec(LUAGLOBAL, 'LuaGlobal');
    }

    // ── luasql.sqlite3 bridge ────────────────────────────────────────────────
    // Exposes globals consumed by Luasql.lua: __sql_open / __sql_exec /
    // __sql_close / __sql_escape. All synchronous — sqlite runs on the main
    // thread, so Lua doesn't need to yield Promises.
    //
    // VFS round-trip: on open we preload from the ProfileVFS via
    // sqlite3_deserialize; the VFS file is the source of truth. After each
    // mutation we schedule a debounced snapshot (setTimeout) back to the same
    // VFS path so a tight INSERT loop coalesces into one write.
    //
    // Row arrays are 1-indexed for Lua: wasmoon's pushTable iterates
    // Object.keys, so a sparse JS array with index 0 absent and 1..n populated
    // lands in Lua as a clean 1-indexed sequence.
    private setupSqlBridge(): void {
        const sql = getSqliteClient();

        const toLuaArray = <T>(arr: T[]): T[] => {
            const r: T[] = [];
            for (let i = 0; i < arr.length; i++) r[i + 1] = arr[i];
            return r;
        };

        const SNAPSHOT_DEBOUNCE_MS = 500;
        const dbPaths = new Map<number, string>();
        const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

        const snapshotNow = (dbId: number): void => {
            const path = dbPaths.get(dbId);
            if (!path || !this.vfs) return;
            try {
                const bytes = sql.exportFile(dbId);
                this.vfs.writeBinaryFile(path, bytes);
            } catch (e) {
                console.warn('[sql snapshot]', path, e);
            }
        };

        const scheduleSnapshot = (dbId: number): void => {
            if (!this.vfs) return;
            const prev = pendingTimers.get(dbId);
            if (prev) clearTimeout(prev);
            const t = setTimeout(() => {
                pendingTimers.delete(dbId);
                snapshotNow(dbId);
            }, SNAPSHOT_DEBOUNCE_MS);
            pendingTimers.set(dbId, t);
        };

        this.lua.global.set('__sql_open', (path: unknown): number => {
            const p = String(path);
            let preload: Uint8Array | undefined;
            if (this.vfs && this.vfs.exists(p)) {
                let raw: Uint8Array;
                try {
                    raw = this.vfs.readBinaryFile(p);
                } catch (e) {
                    throw new Error(`VFS read of '${p}' failed: ${e instanceof Error ? e.message : String(e)}`);
                }
                // Normalize to a fresh, byteOffset=0, standalone Uint8Array —
                // ZenFS may return a Buffer slice that spans only part of an
                // underlying ArrayBuffer.
                const fresh = new Uint8Array(raw.byteLength);
                fresh.set(raw);
                if (fresh.byteLength < 512) {
                    throw new Error(`VFS file '${p}' is ${fresh.byteLength} bytes, too small to be a SQLite database`);
                }
                // Quick header sniff — SQLite files start with "SQLite format 3\0".
                const HDR = 'SQLite format 3\0';
                let headerOk = true;
                for (let i = 0; i < HDR.length; i++) {
                    if (fresh[i] !== HDR.charCodeAt(i)) { headerOk = false; break; }
                }
                if (!headerOk) {
                    throw new Error(`VFS file '${p}' is not a SQLite database (bad header). First bytes: ${Array.from(fresh.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                }
                preload = fresh;
            }
            const dbId = sql.open(p, preload);
            dbPaths.set(dbId, p);
            return dbId;
        });

        this.lua.global.set('__sql_exec', (dbId: unknown, sqlText: unknown) => {
            const id = Number(dbId);
            try {
                const r = sql.exec(id, String(sqlText));
                if (r.kind === 'rows') {
                    const rows1 = toLuaArray(r.rows.map(row => toLuaArray(row as unknown[])));
                    const cols1 = toLuaArray(r.columns);
                    return {kind: 'rows', rows: rows1, columns: cols1};
                }
                // Any non-query (INSERT/UPDATE/DELETE/DDL) — schedule a debounced
                // VFS snapshot. Coalesces a tight db:add loop into one write.
                scheduleSnapshot(id);
                return {kind: 'changes', changes: r.changes};
            } catch (e) {
                return {kind: 'error', message: e instanceof Error ? e.message : String(e)};
            }
        });

        this.lua.global.set('__sql_close', (dbId: unknown): boolean => {
            const id = Number(dbId);
            try {
                const t = pendingTimers.get(id);
                if (t) { clearTimeout(t); pendingTimers.delete(id); }
                snapshotNow(id);
                sql.close(id);
                dbPaths.delete(id);
                return true;
            } catch {
                return false;
            }
        });

        this.lua.global.set('__sql_escape', (s: unknown): string => sql.escape(String(s ?? '')));
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

    load(code: string, name: string): void {
        this.exec(code, name);
    }

    run(code: string, name: string): void {
        this.exec(code, name);
    }

    runWithMatches(
        code: string,
        name: string,
        matches: string[],
        multimatches?: string[][],
        _namedGroups?: Record<string, string>,
    ): void {
        const prev = this.currentMatches;
        this.currentMatches = matches;
        this.setMatches(matches, multimatches);
        try {
            this.execInner(code, name);
        } finally {
            this.currentMatches = prev;
        }
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

    private exec(code: string, name: string): void {
        this.execInner(code, name);
    }

    // Run a chunk on a fresh thread and return its first return value. The
    // fresh thread isolates the chunk's frame from any caller already
    // mid-execution (e.g. a trigger handler calling expandAlias). The chunk
    // returns __exec's (err, result) tuple via the thread's stack, so we read
    // it from there instead of a global to avoid races with re-entrant exec.
    private execInner(code: string, name: string): unknown {
        const t = this.lua.global.newThread();
        try {
            t.loadString('return __exec(...)', '@' + name);
            t.pushValue(code);
            t.pushValue(name);
            const res = t.resume(2);
            t.assertOk(res.result);
            const top = t.getTop();
            const err = top >= 1 ? t.getValue(1) : null;
            const result = top >= 2 ? t.getValue(2) : undefined;
            if (err != null) throw new Error(String(err));
            return result;
        } finally {
            try { t.close(); } catch { /* already closed */ }
        }
    }

    // Run a chunk that doesn't return anything (event/cb/pattern dispatch).
    // The chunk's own pcall captures Lua errors; runtime/wasm errors surface
    // as a thrown JS exception that we route to the error console.
    private runChunk(chunk: string, label: string): void {
        const t = this.lua.global.newThread();
        try {
            t.loadString(chunk, '@' + label);
            const res = t.resume(0);
            t.assertOk(res.result);
        } catch (e) {
            this.api.printError(`[${label}] ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            try { t.close(); } catch { /* already closed */ }
        }
    }

    // Fire a registered Lua callback by id (label clicks, tempTimer/Alias/
    // Trigger/Key).
    private dispatchCb(cbId: number, label: string): void {
        this.runChunk(`__mudix_dispatch_cb(${cbId})`, label);
        this.api.flushOutput();
    }

    private execModule(code: string, name: string, globalName: string): void {
        const result = this.execInner(code, name);
        if (result !== undefined && result !== null) this.lua.global.set(globalName, result);
    }

    emitEvent(event: string, args: unknown[]): void {
        this.lua.global.set('__mudix_evt_args', args);
        this.lua.global.set('__mudix_evt_name', event);
        this.runChunk('__mudix_dispatch_event()', `event "${event}"`);
        this.api.flushOutput();
    }

    setCurrentLine(line: string, isPrompt: boolean): void {
        this.lua.global.set('line', line);
        this._isPrompt = isPrompt;
    }

    dispatchSendRequest(text: string): boolean {
        this._denyCurrentSend = false;
        this.emitEvent('sysDataSendRequest', [text]);
        return this._denyCurrentSend;
    }

    /**
     * Mudlet REGEX_LUA_CODE: the pattern body runs as a Lua function on every
     * incoming line. Side effects (raiseEvent, etc.) always run; the trigger
     * "matches" only when the body returns a truthy value.
     */
    evalTriggerPattern(code: string): boolean {
        this.lua.global.set('__mudix_pat_code', code);
        this.runChunk('__mudix_eval_pattern(__mudix_pat_code)', 'lua-pattern');
        return this.lua.global.get('__mudix_pat_result') === true;
    }

    destroy(): void {
        this.lua.global.close();
    }
}
