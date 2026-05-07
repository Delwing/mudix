// Main-thread sqlite-wasm client. Synchronous from Lua's POV — there is no
// worker hop, no postMessage, no Promises in the trigger hot path.
//
// Trade vs. the previous SAHPool worker:
//   - Persistence is via the existing ProfileVFS round-trip (export bytes →
//     vfs.writeBinaryFile). The DB itself lives in WASM memory.
//   - Module init is async (one-time), but happens before any Lua runs:
//     LuaRuntime.create awaits sqliteReady before installing the bridge.
//   - exec runs on the main thread. For typical MUD-scale workloads this is
//     fine; if it ever isn't, snapshot export can be moved to a worker without
//     re-introducing async on the call path.
import sqlite3InitModule, {type Database, type SqlValue, type Sqlite3Static} from '@sqlite.org/sqlite-wasm';

type ExecResult =
    | { kind: 'rows'; rows: SqlValue[][]; columns: string[] }
    | { kind: 'changes'; changes: number };

let sqlite3: Sqlite3Static | null = null;
let initError: Error | null = null;

export const sqliteReady: Promise<void> = (async () => {
    try {
        sqlite3 = await sqlite3InitModule();
    } catch (e) {
        initError = e instanceof Error ? e : new Error(String(e));
    }
})();

export class SqliteClient {
    private readonly dbs = new Map<number, Database>();
    private nextId = 1;

    private get s(): Sqlite3Static {
        if (initError) throw new Error('sqlite init failed: ' + initError.message);
        if (!sqlite3) throw new Error('sqlite not initialized — await sqliteReady before use');
        return sqlite3;
    }

    open(_path: string, preload?: Uint8Array): number {
        const sqlite3 = this.s;
        // We don't use the path — there's no persistent VFS here. Identity
        // (preload bytes vs. fresh) is what matters; the snapshot back to the
        // ProfileVFS uses the path supplied to setupSqlBridge, not this one.
        const db = new sqlite3.oo1.DB(':memory:', 'c');
        if (preload && preload.byteLength > 0) {
            // sqlite3_deserialize takes ownership of the byte buffer once we
            // pass FREEONCLOSE — copy into sqlite-managed memory so the
            // caller's Uint8Array stays valid and we don't double-free.
            const bytes = preload.byteLength;
            const ptr = sqlite3.wasm.alloc(bytes);
            sqlite3.wasm.heap8u().set(preload, ptr);
            const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
                | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
            const rc = sqlite3.capi.sqlite3_deserialize(db.pointer!, 'main', ptr, bytes, bytes, flags);
            if (rc !== sqlite3.capi.SQLITE_OK) {
                sqlite3.wasm.dealloc(ptr);
                db.close();
                throw new Error(`sqlite3_deserialize failed: rc=${rc}`);
            }
        }
        const dbId = this.nextId++;
        this.dbs.set(dbId, db);
        return dbId;
    }

    exec(dbId: number, sql: string): ExecResult {
        const db = this.dbs.get(dbId);
        if (!db) throw new Error('invalid dbId');
        const rows: SqlValue[][] = [];
        const columns: string[] = [];
        db.exec({
            sql,
            rowMode: 'array',
            resultRows: rows,
            columnNames: columns,
        });
        if (columns.length === 0) {
            return { kind: 'changes', changes: db.changes() as number };
        }
        return { kind: 'rows', rows, columns };
    }

    exportFile(dbId: number): Uint8Array {
        const db = this.dbs.get(dbId);
        if (!db) throw new Error('invalid dbId');
        // Returns a fresh Uint8Array containing the full DB image — usable as
        // a regular .sqlite file.
        return this.s.capi.sqlite3_js_db_export(db.pointer!);
    }

    close(dbId: number): void {
        const db = this.dbs.get(dbId);
        if (!db) return;
        db.close();
        this.dbs.delete(dbId);
    }

    // Single-quote escape — sufficient for SQLite TEXT literals. Mudlet's
    // luasql.sqlite3:escape() does the same.
    escape(s: string): string {
        return String(s).replace(/'/g, "''");
    }
}

let _instance: SqliteClient | null = null;

export function getSqliteClient(): SqliteClient {
    if (!_instance) _instance = new SqliteClient();
    return _instance;
}
