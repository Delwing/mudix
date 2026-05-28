/// <reference lib="webworker" />

// PoC scripting worker: hosts wasmoon, sqlite-wasm, and a ZenFS profile mount
// entirely off the main thread. Goal is to prove that Lua → DB and Lua → VFS
// stay synchronous inside the worker (no postMessage per call) and that bulk
// boot work (sqlite WASM init, ZenFS IDB mount) doesn't block the UI.
//
// Storage isolation: we mount IndexedDB under store name
//   mudix_poc_<connectionId>
// distinct from the main app's `mudix_vfs_<connectionId>`, so this PoC cannot
// corrupt real profile data.

import { Lua } from 'wasmoon-lua5.1';

type LuaEngine = Awaited<ReturnType<typeof Lua.create>>;
import sqlite3InitModule, {
    type Database,
    type SqlValue,
    type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import {
    configure,
    InMemory,
    mount,
    resolveMountConfig,
    readFileSync,
    writeFileSync,
    mkdirSync,
    rmdirSync,
    readdirSync,
    statSync,
    existsSync,
    unlinkSync,
    renameSync,
    type FileSystem,
} from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';

import type { Req, Res, InitRes, EvalRes, ErrRes, ShutdownRes } from './protocol';

const ctx = self as unknown as {
    postMessage: (m: Res) => void;
    addEventListener: (t: 'message', fn: (e: MessageEvent<Req>) => void) => void;
};

type Syncable = FileSystem & { sync?: () => Promise<void> };

let lua: LuaEngine | null = null;
let sqlite3: Sqlite3Static | null = null;
let profilePath = '';
let pocLogs: string[] = [];

// ── ZenFS ────────────────────────────────────────────────────────────────────

async function mountVfs(connectionId: string): Promise<string> {
    await configure({ mounts: { '/': InMemory } });
    const fs = (await resolveMountConfig({
        backend: IndexedDB,
        storeName: `mudix_poc_${connectionId}`,
    })) as Syncable;
    fs.attributes.set('no_atime');
    const path = `/profiles/${connectionId}`;
    mount(path, fs);
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
    return path;
}

function vfsResolve(p: string): string {
    if (p.startsWith('/')) return p;
    return `${profilePath}/${p}`;
}

function ensureParent(abs: string): void {
    const parent = abs.substring(0, abs.lastIndexOf('/'));
    if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
}

// ── sqlite-wasm (in-worker) ──────────────────────────────────────────────────

const dbs = new Map<number, Database>();
const dbPaths = new Map<number, string>();
let nextDbId = 1;

function sqlOpen(path: string, preload?: Uint8Array): number {
    if (!sqlite3) throw new Error('sqlite not ready');
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    if (preload && preload.byteLength > 0) {
        const bytes = preload.byteLength;
        const ptr = sqlite3.wasm.alloc(bytes);
        sqlite3.wasm.heap8u().set(preload, ptr);
        const flags =
            sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
            sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
        const rc = sqlite3.capi.sqlite3_deserialize(
            db.pointer!, 'main', ptr, bytes, bytes, flags,
        );
        if (rc !== sqlite3.capi.SQLITE_OK) {
            sqlite3.wasm.dealloc(ptr);
            db.close();
            throw new Error(`sqlite3_deserialize failed: rc=${rc}`);
        }
    }
    const id = nextDbId++;
    dbs.set(id, db);
    dbPaths.set(id, path);
    return id;
}

type ExecOk =
    | { kind: 'rows'; rows: SqlValue[][]; columns: string[] }
    | { kind: 'changes'; changes: number };

function sqlExec(id: number, sqlText: string): ExecOk {
    const db = dbs.get(id);
    if (!db) throw new Error('invalid dbId');
    const rows: SqlValue[][] = [];
    const columns: string[] = [];
    db.exec({ sql: sqlText, rowMode: 'array', resultRows: rows, columnNames: columns });
    if (columns.length === 0) {
        return { kind: 'changes', changes: db.changes() as number };
    }
    return { kind: 'rows', rows, columns };
}

function sqlExportFile(id: number): Uint8Array {
    const db = dbs.get(id);
    if (!db || !sqlite3) throw new Error('invalid dbId');
    return sqlite3.capi.sqlite3_js_db_export(db.pointer!);
}

function sqlClose(id: number): void {
    const db = dbs.get(id);
    if (!db) return;
    db.close();
    dbs.delete(id);
    dbPaths.delete(id);
}

// Snapshot back to VFS — same pattern as the main-thread LuaRuntime.
function snapshotDbToVfs(id: number): void {
    const path = dbPaths.get(id);
    if (!path) return;
    try {
        const bytes = sqlExportFile(id);
        if (bytes.byteLength === 0) return;
        const abs = vfsResolve(path);
        ensureParent(abs);
        writeFileSync(abs, bytes);
    } catch (e) {
        console.warn('[poc snapshot]', path, e);
    }
}

// ── Lua bridge globals ───────────────────────────────────────────────────────

function installBridge(engine: LuaEngine): void {
    const g = engine.global;

    // logs go back to the main thread with the eval result
    g.set('mudix_log', (s: unknown) => {
        pocLogs.push(String(s));
    });

    // SQL bridge — same shape as the main-thread one so familiar Lua works.
    g.set('__sql_open', (path: unknown): number => {
        const p = String(path);
        let preload: Uint8Array | undefined;
        const abs = vfsResolve(p);
        if (existsSync(abs)) {
            const raw = readFileSync(abs) as unknown as Uint8Array;
            const fresh = new Uint8Array(raw.byteLength);
            fresh.set(raw);
            if (fresh.byteLength >= 16) preload = fresh;
        }
        return sqlOpen(p, preload);
    });

    g.set('__sql_exec', (idArg: unknown, sqlText: unknown) => {
        const id = Number(idArg);
        try {
            const r = sqlExec(id, String(sqlText));
            if (r.kind === 'rows') {
                // 1-indexed rows for Lua. Small PoC payloads — no source-literal
                // optimization, just cross the boundary.
                const luaRows: SqlValue[][] = [];
                for (let i = 0; i < r.rows.length; i++) {
                    const row = r.rows[i];
                    const out: SqlValue[] = [];
                    for (let j = 0; j < row.length; j++) out[j + 1] = row[j];
                    luaRows[i + 1] = out;
                }
                const cols: string[] = [];
                for (let i = 0; i < r.columns.length; i++) cols[i + 1] = r.columns[i];
                return { kind: 'rows', rows: luaRows, columns: cols };
            }
            // Snapshot synchronously on mutations — PoC keeps it simple; the
            // production engine debounces. Round-trip cost shows up in the bench.
            snapshotDbToVfs(id);
            return { kind: 'changes', changes: r.changes };
        } catch (e) {
            return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    });

    g.set('__sql_close', (idArg: unknown): boolean => {
        const id = Number(idArg);
        try {
            snapshotDbToVfs(id);
            sqlClose(id);
            return true;
        } catch {
            return false;
        }
    });

    g.set('__sql_escape', (s: unknown): string =>
        String(s ?? '').replace(/'/g, "''"));

    // Minimal VFS bridge — read/write/list/exists/stat/mkdir/rm/rename.
    g.set('__vfs_read', (path: unknown): string => {
        return readFileSync(vfsResolve(String(path)), 'utf8') as string;
    });

    g.set('__vfs_write', (path: unknown, content: unknown): void => {
        const abs = vfsResolve(String(path));
        ensureParent(abs);
        writeFileSync(abs, String(content), 'utf8');
    });

    g.set('__vfs_exists', (path: unknown): boolean => {
        try { return existsSync(vfsResolve(String(path))); } catch { return false; }
    });

    g.set('__vfs_unlink', (path: unknown): boolean => {
        try { unlinkSync(vfsResolve(String(path))); return true; } catch { return false; }
    });

    g.set('__vfs_rename', (a: unknown, b: unknown): boolean => {
        try { renameSync(vfsResolve(String(a)), vfsResolve(String(b))); return true; }
        catch { return false; }
    });

    g.set('__vfs_mkdir', (path: unknown): boolean => {
        try { mkdirSync(vfsResolve(String(path)), { recursive: true }); return true; }
        catch { return false; }
    });

    g.set('__vfs_rmdir', (path: unknown): boolean => {
        try { rmdirSync(vfsResolve(String(path))); return true; } catch { return false; }
    });

    g.set('__vfs_readdir', (path: unknown): string[] => {
        try {
            const list = readdirSync(vfsResolve(String(path))) as string[];
            const out: string[] = [];
            for (let i = 0; i < list.length; i++) out[i + 1] = list[i];
            return out;
        } catch { return []; }
    });

    g.set('__vfs_stat', (path: unknown) => {
        try {
            const s = statSync(vfsResolve(String(path)));
            return {
                type: s.isDirectory() ? 'dir' : 'file',
                size: s.size,
                mtime: s.mtimeMs,
            };
        } catch { return null; }
    });

    // Convenience Lua-side helpers so the PoC scripts read naturally.
    engine.doStringSync(`
        mudix = mudix or {}
        function mudix.log(s) mudix_log(tostring(s)) end
        function mudix.now() return __now() end
        function mudix.vfs_write(p, c) __vfs_write(p, c) end
        function mudix.vfs_read(p) return __vfs_read(p) end
        function mudix.vfs_exists(p) return __vfs_exists(p) end
        function mudix.vfs_readdir(p) return __vfs_readdir(p) end
        function mudix.vfs_stat(p) return __vfs_stat(p) end
        function mudix.vfs_unlink(p) return __vfs_unlink(p) end
        function mudix.vfs_mkdir(p) return __vfs_mkdir(p) end

        -- Tiny db wrapper, just enough for the PoC.
        mudix.db = {}
        function mudix.db.open(path) return __sql_open(path) end
        function mudix.db.close(id) return __sql_close(id) end
        function mudix.db.exec(id, sql)
            local r = __sql_exec(id, sql)
            if r.kind == 'error' then error(r.message, 2) end
            return r
        end
        function mudix.db.escape(s) return __sql_escape(s) end
    `);

    g.set('__now', () => performance.now());
}

// ── lifecycle / message loop ─────────────────────────────────────────────────

async function init(req: { id: number; connectionId: string }): Promise<void> {
    const t0 = performance.now();
    try {
        profilePath = await mountVfs(req.connectionId);
        sqlite3 = await sqlite3InitModule();
        lua = await Lua.create();
        installBridge(lua);
        const res: InitRes = {
            type: 'init-ok',
            id: req.id,
            ms: performance.now() - t0,
        };
        ctx.postMessage(res);
    } catch (e) {
        const res: ErrRes = {
            type: 'err',
            id: req.id,
            error: e instanceof Error ? e.message + '\n' + (e.stack ?? '') : String(e),
        };
        ctx.postMessage(res);
    }
}

function evalLua(req: { id: number; lua: string }): void {
    if (!lua) {
        const res: ErrRes = { type: 'err', id: req.id, error: 'worker not initialized' };
        ctx.postMessage(res);
        return;
    }
    pocLogs = [];
    const t0 = performance.now();
    try {
        const result = lua.doStringSync(req.lua) as unknown;
        const res: EvalRes = {
            type: 'eval-ok',
            id: req.id,
            result: safeClone(result),
            ms: performance.now() - t0,
            logs: pocLogs,
        };
        ctx.postMessage(res);
    } catch (e) {
        const err: ErrRes = {
            type: 'err',
            id: req.id,
            error: e instanceof Error ? e.message : String(e),
        };
        ctx.postMessage(err);
    } finally {
        pocLogs = [];
    }
}

// structuredClone barfs on functions / Lua refs — strip them for the response.
function safeClone(v: unknown): unknown {
    try { return structuredClone(v); } catch { return String(v); }
}

function shutdown(req: { id: number }): void {
    try {
        for (const id of [...dbs.keys()]) sqlClose(id);
        lua?.global.close();
        lua = null;
    } catch (e) { console.warn('[poc shutdown]', e); }
    const res: ShutdownRes = { type: 'shutdown-ok', id: req.id };
    ctx.postMessage(res);
}

ctx.addEventListener('message', (event: MessageEvent<Req>) => {
    const req = event.data;
    switch (req.type) {
        case 'init': void init(req); break;
        case 'eval': evalLua(req); break;
        case 'shutdown': shutdown(req); break;
    }
});
