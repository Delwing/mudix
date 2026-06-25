// Shared host: hosts wasmoon, sqlite-wasm, and a ZenFS profile mount, and
// installs the __sql_* / __vfs_* Lua bridge. Runs unchanged on the main thread
// or inside a Web Worker — neither postMessage nor `self` is referenced here.
//
// The PoC drives both contexts through this same module so timings compare
// apples to apples: same wasmoon, same sqlite, same ZenFS, same Lua API.
//
// Storage paths are caller-supplied (mudix_poc_worker_<id> vs
// mudix_poc_main_<id>) so the two hosts don't share state.

import { Lua } from 'wasmoon-lua5.1';
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

type LuaEngine = Awaited<ReturnType<typeof Lua.create>>;
type Syncable = FileSystem & { sync?: () => Promise<void> };

export interface EvalResult {
    result: unknown;
    ms: number;
    logs: string[];
}

export interface Host {
    eval(lua: string): EvalResult;
    shutdown(): void;
}

// configure() sets up the root and can only be called once per JS context.
// Both worker and main may call createHost — guard the call.
let rootReady: Promise<void> | null = null;
function ensureRoot(): Promise<void> {
    if (!rootReady) rootReady = configure({ mounts: { '/': InMemory } });
    return rootReady;
}

export async function createHost(
    connectionId: string,
    storePrefix: 'mudix_poc_worker' | 'mudix_poc_main',
): Promise<Host> {
    await ensureRoot();
    const fs = (await resolveMountConfig({
        backend: IndexedDB,
        storeName: `${storePrefix}_${connectionId}`,
    })) as Syncable;
    fs.attributes.set('no_atime');
    const profilePath = `/profiles/${storePrefix}_${connectionId}`;
    mount(profilePath, fs);
    if (!existsSync(profilePath)) mkdirSync(profilePath, { recursive: true });

    const sqlite3 = await sqlite3InitModule();
    const lua = await Lua.create();

    const state = installBridge(lua, sqlite3, profilePath);

    return {
        eval(luaSrc: string): EvalResult {
            state.logs.length = 0;
            const t0 = performance.now();
            const result = lua.doStringSync(luaSrc) as unknown;
            return {
                result: safeClone(result),
                ms: performance.now() - t0,
                logs: [...state.logs],
            };
        },
        shutdown(): void {
            for (const id of [...state.dbs.keys()]) {
                try { state.dbs.get(id)?.close(); } catch { /* ignore */ }
            }
            state.dbs.clear();
            state.dbPaths.clear();
            try { lua.global.close(); } catch { /* ignore */ }
        },
    };
}

interface BridgeState {
    logs: string[];
    dbs: Map<number, Database>;
    dbPaths: Map<number, string>;
}

function installBridge(
    lua: LuaEngine,
    sqlite3: Sqlite3Static,
    profilePath: string,
): BridgeState {
    const state: BridgeState = {
        logs: [],
        dbs: new Map(),
        dbPaths: new Map(),
    };
    let nextDbId = 1;

    const resolve = (p: string): string =>
        p.startsWith('/') ? p : `${profilePath}/${p}`;

    const ensureParent = (abs: string): void => {
        const parent = abs.substring(0, abs.lastIndexOf('/'));
        if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
    };

    const snapshot = (dbId: number): void => {
        const path = state.dbPaths.get(dbId);
        const db = state.dbs.get(dbId);
        if (!path || !db) return;
        try {
            const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer!);
            if (bytes.byteLength === 0) return;
            const abs = resolve(path);
            ensureParent(abs);
            writeFileSync(abs, bytes);
        } catch (e) {
            console.warn('[poc snapshot]', path, e);
        }
    };

    const g = lua.global;

    g.set('mudix_log', (s: unknown) => { state.logs.push(String(s)); });
    g.set('__now', () => performance.now());

    // ── SQL bridge ──────────────────────────────────────────────────────────
    g.set('__sql_open', (pathArg: unknown): number => {
        const p = String(pathArg);
        const abs = resolve(p);
        let preload: Uint8Array | undefined;
        if (existsSync(abs)) {
            const raw = readFileSync(abs) as unknown as Uint8Array;
            const fresh = new Uint8Array(raw.byteLength);
            fresh.set(raw);
            if (fresh.byteLength >= 16) preload = fresh;
        }
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
        state.dbs.set(id, db);
        state.dbPaths.set(id, p);
        return id;
    });

    g.set('__sql_exec', (idArg: unknown, sqlText: unknown) => {
        const id = Number(idArg);
        const db = state.dbs.get(id);
        if (!db) return { kind: 'error', message: 'invalid dbId' };
        try {
            const rows: SqlValue[][] = [];
            const columns: string[] = [];
            db.exec({
                sql: String(sqlText),
                rowMode: 'array',
                resultRows: rows,
                columnNames: columns,
            });
            if (columns.length === 0) {
                snapshot(id);
                return { kind: 'changes', changes: db.changes() as number };
            }
            const luaRows: SqlValue[][] = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const out: SqlValue[] = [];
                for (let j = 0; j < row.length; j++) out[j + 1] = row[j];
                luaRows[i + 1] = out;
            }
            const cols: string[] = [];
            for (let i = 0; i < columns.length; i++) cols[i + 1] = columns[i];
            return { kind: 'rows', rows: luaRows, columns: cols };
        } catch (e) {
            return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
        }
    });

    g.set('__sql_close', (idArg: unknown): boolean => {
        const id = Number(idArg);
        const db = state.dbs.get(id);
        if (!db) return false;
        try {
            snapshot(id);
            db.close();
            state.dbs.delete(id);
            state.dbPaths.delete(id);
            return true;
        } catch { return false; }
    });

    g.set('__sql_escape', (s: unknown): string =>
        String(s ?? '').replace(/'/g, "''"));

    // ── VFS bridge ──────────────────────────────────────────────────────────
    g.set('__vfs_read', (p: unknown): string =>
        readFileSync(resolve(String(p)), 'utf8') as string);

    g.set('__vfs_write', (p: unknown, c: unknown): void => {
        const abs = resolve(String(p));
        ensureParent(abs);
        writeFileSync(abs, String(c), 'utf8');
    });

    g.set('__vfs_exists', (p: unknown): boolean => {
        try { return existsSync(resolve(String(p))); } catch { return false; }
    });

    g.set('__vfs_unlink', (p: unknown): boolean => {
        try { unlinkSync(resolve(String(p))); return true; } catch { return false; }
    });

    g.set('__vfs_rename', (a: unknown, b: unknown): boolean => {
        try { renameSync(resolve(String(a)), resolve(String(b))); return true; }
        catch { return false; }
    });

    g.set('__vfs_mkdir', (p: unknown): boolean => {
        try { mkdirSync(resolve(String(p)), { recursive: true }); return true; }
        catch { return false; }
    });

    g.set('__vfs_rmdir', (p: unknown): boolean => {
        try { rmdirSync(resolve(String(p))); return true; } catch { return false; }
    });

    g.set('__vfs_readdir', (p: unknown): string[] => {
        try {
            const list = readdirSync(resolve(String(p))) as string[];
            const out: string[] = [];
            for (let i = 0; i < list.length; i++) out[i + 1] = list[i];
            return out;
        } catch { return []; }
    });

    g.set('__vfs_stat', (p: unknown) => {
        try {
            const s = statSync(resolve(String(p)));
            return {
                type: s.isDirectory() ? 'dir' : 'file',
                size: s.size,
                mtime: s.mtimeMs,
            };
        } catch { return null; }
    });

    // Lua-side ergonomic shims.
    lua.doStringSync(`
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

    return state;
}

function safeClone(v: unknown): unknown {
    try { return structuredClone(v); } catch { return String(v); }
}
