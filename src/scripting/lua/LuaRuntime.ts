import {Lua} from 'wasmoon-lua5.1';
import type {IScriptingRuntime} from '../IScriptingRuntime';
import type {ScriptingAPI} from '../ScriptingAPI';
import type {ProfileVFS} from '../vfs/ProfileVFS';
import STRINGUTILS from './StringUtils.lua?raw';
import TABLEUTILS from './TableUtils.lua?raw';
import OTHER from './Other.lua?raw';
import GUIUTILS from './GUIUtils.lua?raw';
import UTF8 from './utf8.lua?raw';
import INSPECT from './Inspect.lua?raw';
import DEBUGTOOLS from './DebugTools.lua?raw';
import VFS_LUA from './VFS.lua?raw';
import {setupRex} from './rex';

const DOCKMAP: Record<string, string> = {
    r: 'right',
    l: 'left',
    t: 'top',
    b: 'bottom',
    main: 'main',
}


export class LuaRuntime implements IScriptingRuntime {

    // Handlers registered via the JS primitive registerAnonymousEventHandler
    // (before Other.lua overwrites it with the Lua version). In practice this
    // will only ever contain {"*": ["dispatchEventToFunctions"]}.
    private readonly anonHandlers = new Map<string, string[]>();

    // Temp alias/trigger IDs → unsub fns (engines return unsub, not numeric IDs).
    private readonly tempIds = new Map<number, () => void>();
    private nextTempId = 1;
    private _isPrompt = false;

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
                    this.api.windows.write(a, b);
                }
            } else {
                this.api.echo(a);
            }
        });

        // Format state — called by xEcho between text chunks.
        // Lua uses two calling conventions: (win, r, g, b) and (r, g, b).
        this.lua.global.set('setFgColor', (winOrR: unknown, rOrG: number, gOrB?: number, b?: number) => {
            if (typeof winOrR === 'string') {
                this.api.setFgColor(rOrG, gOrB!, b!, winOrR);
            } else {
                this.api.setFgColor(winOrR as number, rOrG, gOrB!);
            }
        });
        this.lua.global.set('setBgColor', (winOrR: unknown, rOrG: number, gOrB?: number, b?: number) => {
            if (typeof winOrR === 'string') {
                this.api.setBgColor(rOrG, gOrB!, b!, winOrR);
            } else {
                this.api.setBgColor(winOrR as number, rOrG, gOrB!);
            }
        });
        this.lua.global.set('setBold', (_win: string, v: boolean) => this.api.setBold(v));
        this.lua.global.set('setItalics', (_win: string, v: boolean) => this.api.setItalic(v));
        this.lua.global.set('setUnderline', (_win: string, v: boolean) => this.api.setUnderline(v));
        this.lua.global.set('setStrikeOut', (_win: string, v: boolean) => this.api.setStrikethrough(v));
        this.lua.global.set('resetFormat', (_win?: string) => this.api.resetFormat(_win));
        this.lua.global.set('deselect', (_win?: string) => this.api.deselect());

        this.lua.global.set('getProfileName', () => this.api.profileName);

        // JS primitive — Other.lua calls this once to seed dispatchEventToFunctions,
        // then immediately overwrites the global with its own Lua implementation.
        this.lua.global.set('registerAnonymousEventHandler', (event: string, func: unknown) => {
            if (typeof func === 'string') {
                const bucket = this.anonHandlers.get(event) ?? [];
                this.anonHandlers.set(event, bucket);
                bucket.push(func);
            }
            return 0;
        });

        this.lua.global.set('raiseEvent', (event: string, ...args: unknown[]) => {
            void this.dispatchToHandlers(event, args);
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
        this.lua.global.set('setWindowTitle', (name: string, title: string) => this.api.windows.setTitle(name, title));

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
        this.lua.global.set('echoLink', (a: unknown, b: unknown, c: unknown, d?: unknown, e?: unknown) => {
            // Calling conventions (Mudlet-compatible):
            //   echoLink(text, cmd, tooltip [, fmt])          — 3-4 args, no window
            //   echoLink(window, text, cmd, tooltip [, fmt])  — 4-5 args, with window
            // Distinguish by typeof d: 'string' = tooltip (window form), 'boolean' = fmt (no-window form)
            const hasWindow = typeof d === 'string';
            const [text, cmd, tooltip] = hasWindow
                ? [b as string, c, d as string]   // window, text, cmd, tooltip [, fmt]
                : [a as string, b, c as string];  // text, cmd, tooltip [, fmt]
            if (typeof cmd === 'function') {
                this.api.echoLink(text, () => { (cmd as () => void)(); this.api.flushOutput(); }, tooltip);
            } else {
                this.api.echoLink(text, cmd as string, tooltip);
            }
        });
        this.lua.global.set('openWebPage', (url: string) => { window.open(url, '_blank'); });

        // ── Send ─────────────────────────────────────────────────────────────
        this.lua.global.set('send', (text: string, echo?: boolean) => this.api.send(text, echo ?? true));

        // ── Command bar ───────────────────────────────────────────────────────
        this.lua.global.set('appendCmdLine', (text: string) => this.api.appendCmdLine(text));
        this.lua.global.set('setCmdLine',    (text: string) => this.api.setCmdLine(text));

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

        // ── Timers ────────────────────────────────────────────────────────────
        this.lua.global.set('tempTimer', (seconds: number, fn: unknown, repeat?: boolean) => {
            return this.api.timers.addTemp(seconds, () => {
                if (typeof fn === 'function') (fn as () => void)();
                this.api.flushOutput();
            }, repeat ?? false);
        });
        this.lua.global.set('killTimer', (id: number) => this.api.timers.killTimer(id));

        // ── Aliases ───────────────────────────────────────────────────────────
        this.lua.global.set('tempAlias', (pattern: string, fn: unknown) => {
            const id = this.nextTempId++;
            const unsub = this.api.aliases.addTemp(pattern, (m: RegExpMatchArray) => {
                this.lua.global.set('matches', Array.from(m));
                if (typeof fn === 'function') (fn as () => void)();
                this.api.flushOutput();
            });
            this.tempIds.set(id, unsub);
            return id;
        });
        this.lua.global.set('killAlias', (id: number) => {
            const unsub = this.tempIds.get(id);
            if (!unsub) return false;
            unsub(); this.tempIds.delete(id); return true;
        });

        // ── Triggers ──────────────────────────────────────────────────────────
        this.lua.global.set('tempTrigger', (pattern: string, fn: unknown) => {
            const id = this.nextTempId++;
            const unsub = this.api.triggers.addTemp(pattern, (m: RegExpMatchArray) => {
                this.lua.global.set('matches', Array.from(m));
                if (typeof fn === 'function') (fn as () => void)();
                this.api.flushOutput();
            });
            this.tempIds.set(id, unsub);
            return id;
        });
        this.lua.global.set('killTrigger', (id: number) => {
            const unsub = this.tempIds.get(id);
            if (!unsub) return false;
            unsub(); this.tempIds.delete(id); return true;
        });

        // ── Keys ──────────────────────────────────────────────────────────────
        this.lua.global.set('tempKey', (modifier: number, key: string | number, fn: unknown) => {
            const mods: string[] = [];
            if (modifier & 0x4000000) mods.push('ctrl');
            if (modifier & 0x2000000) mods.push('shift');
            if (modifier & 0x8000000) mods.push('alt');
            if (modifier & 0x10000000) mods.push('meta');
            const keyStr = typeof key === 'string' ? key : String(key);
            return this.api.keys.addTemp(keyStr, mods, () => {
                if (typeof fn === 'function') (fn as () => void)();
                this.api.flushOutput();
            });
        });
        this.lua.global.set('killKey', (id: number) => this.api.keys.killKey(id));

        await this.lua.doString(`
matches = {}; multimatches = {}
function getRoomCoordinates(id)
    local t = __getRoomCoordinates(id)
    if t then return t[1], t[2], t[3] end
    return false
end
`);
        await setupRex(this.lua);
        await this.execModule(UTF8, 'utf8', 'utf8');
        await this.exec(INSPECT, 'Inspect');
        await this.exec(DEBUGTOOLS, 'DebugTools');
        await this.exec(TABLEUTILS, 'TableUtils');
        await this.exec(STRINGUTILS, 'StringUtils');
        await this.exec(OTHER, 'Other');
        await this.exec(GUIUTILS, 'GUIUtils');
        if (this.vfs) {
            this.setupVFS(this.vfs);
            await this.exec(VFS_LUA, 'VFS');
        }
    }

    // ── VFS bridge ───────────────────────────────────────────────────────────

    private setupVFS(vfs: ProfileVFS): void {
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
        this.lua.global.set('__vfs_exists__', (path: string) => vfs.exists(path));
        this.lua.global.set('__vfs_profile_dir__', () => vfs.profilePath);

        this.lua.global.set('__vfs_io_open__', (filename: string, mode: string): number | null => {
            try {
                const m = (mode ?? 'r').replace(/b/g, '');
                let content = '';
                if (m === 'r' || m === 'r+') {
                    if (!vfs.exists(filename)) {
                        lastError = `cannot open '${filename}': No such file or directory`;
                        return null;
                    }
                    content = vfs.readFile(filename);
                } else if (m === 'a' || m === 'a+') {
                    if (vfs.exists(filename)) content = vfs.readFile(filename);
                }
                const id = nextId++;
                const dirty = m === 'w' || m === 'w+';
                handles.set(id, {
                    path: vfs.resolvePath(filename),
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
                if (h.dirty) vfs.writeFile(h.path, h.content);
                handles.delete(id);
                return null;
            } catch (e) {
                handles.delete(id);
                return e instanceof Error ? e.message : String(e);
            }
        });

        this.lua.global.set('__vfs_os_remove__', (path: string): boolean => {
            try { vfs.deleteFile(path); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_chdir__', (path: string): boolean => {
            const err = vfs.chdir(path);
            if (err) { lastError = err; return false; }
            return true;
        });

        this.lua.global.set('__vfs_lfs_currentdir__', () => vfs.cwd);

        this.lua.global.set('__vfs_lfs_mkdir__', (path: string): boolean => {
            try { vfs.mkdir(path); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_rmdir__', (path: string): boolean => {
            try { vfs.rmdir(path); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_dir__', (path: string): string[] | null => {
            try {
                return ['.', '..', ...vfs.readdir(path)];
            } catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                return null;
            }
        });

        this.lua.global.set('__vfs_lfs_stat__', (path: string): object | null => {
            const s = vfs.stat(path);
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
        this.lua.global.set('matches', matches);
        this.lua.global.set('multimatches', multimatches ?? []);
        await this.exec(code, name);
    }

    private async exec(code: string, name: string): Promise<void> {
        this.lua.global.loadString(code, `@${name}`);
        await this.lua.global.run();
    }

    private async execModule(code: string, name: string, globalName: string): Promise<void> {
        this.lua.global.loadString(code, `@${name}`);
        const result = await this.lua.global.run();
        if (result !== undefined) this.lua.global.set(globalName, result);
    }

    processTrigger(_line: string): void {
    }

    processInput(_text: string): boolean {
        return false;
    }

    processKey(_event: KeyboardEvent): boolean {
        return false;
    }

    emitEvent(event: string, args: unknown[]): void {
        // Named-global fallback: scripts that define a top-level function with the event name.
        this.lua.global.get(event).then((fn: unknown) => {
            if (typeof fn === 'function') (fn as (...a: unknown[]) => void)(...args);
        });
        void this.dispatchToHandlers(event, args);
    }

    private async dispatchToHandlers(event: string, args: unknown[]): Promise<void> {
        for (const key of [event, '*']) {
            const bucket = this.anonHandlers.get(key);
            if (!bucket) continue;
            for (const name of [...bucket]) {
                try {
                    const fn = await this.lua.global.get(name);
                    if (typeof fn === 'function') {
                        (fn as (...a: unknown[]) => void)(event, ...args);
                    }
                } catch (err) {
                    this.api.printError(`[event "${event}"] ${err instanceof Error ? err.message : String(err)}`);
                }
            }
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
