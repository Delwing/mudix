/// <reference lib="webworker" />
import sqlite3InitModule, {type SAHPoolUtil, type OpfsSAHPoolDatabase, type SqlValue} from '@sqlite.org/sqlite-wasm';

type ExecResult =
    | { kind: 'rows'; rows: SqlValue[][]; columns: string[] }
    | { kind: 'changes'; changes: number };

type Req =
    | { id: number; op: 'open'; args: { path: string; preload?: Uint8Array } }
    | { id: number; op: 'exec'; args: { dbId: number; sql: string } }
    | { id: number; op: 'export'; args: { dbId: number } }
    | { id: number; op: 'close'; args: { dbId: number } };

type Res =
    | { id: number; ok: true; result: unknown }
    | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let pool: SAHPoolUtil | null = null;
let initError: string | null = null;
const dbs = new Map<number, { db: OpfsSAHPoolDatabase; path: string }>();
let nextDbId = 1;

const ready = (async () => {
    try {
        const sqlite3 = await sqlite3InitModule();
        // SAHPool VFS — synchronous OPFS-backed storage. Worker-only (it uses
        // FileSystemSyncAccessHandle). No COOP/COEP needed because we don't use SAB.
        pool = await sqlite3.installOpfsSAHPoolVfs({
            name: 'mudix-sahpool',
            initialCapacity: 8,
        });
    } catch (e) {
        initError = e instanceof Error ? e.message : String(e);
    }
})();

ctx.onmessage = async (e: MessageEvent<Req>) => {
    const { id } = e.data;
    await ready;
    try {
        if (initError) throw new Error('sqlite init failed: ' + initError);
        if (!pool) throw new Error('sqlite pool not ready');
        const result = await handle(e.data);
        const res: Res = { id, ok: true, result };
        // Transfer the Uint8Array's buffer for export to avoid a copy.
        const transfer = result instanceof Uint8Array ? [result.buffer] : [];
        ctx.postMessage(res, transfer as unknown as Transferable[]);
    } catch (err) {
        const res: Res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
        ctx.postMessage(res);
    }
};

async function handle(req: Req): Promise<unknown> {
    switch (req.op) {
        case 'open': {
            // SAHPool paths must start with '/'. We treat the input as a logical name.
            const path = req.args.path.startsWith('/') ? req.args.path : '/' + req.args.path;
            // If the caller supplies preload bytes (loaded from the VFS by the
            // main thread), seed the SAHPool slot with them — overwriting any
            // stale runtime cache so the VFS file is the source of truth.
            if (req.args.preload && req.args.preload.byteLength > 0) {
                await pool!.importDb(path, req.args.preload);
            }
            const db = new pool!.OpfsSAHPoolDb(path);
            const dbId = nextDbId++;
            dbs.set(dbId, { db, path });
            return { dbId };
        }
        case 'exec': {
            const entry = dbs.get(req.args.dbId);
            if (!entry) throw new Error('invalid dbId');
            const rows: SqlValue[][] = [];
            const columns: string[] = [];
            entry.db.exec({
                sql: req.args.sql,
                rowMode: 'array',
                resultRows: rows,
                columnNames: columns,
            });
            // If the statement produced no result columns, treat as a non-query
            // and report the change count instead.
            if (columns.length === 0) {
                const out: ExecResult = { kind: 'changes', changes: entry.db.changes() };
                return out;
            }
            const out: ExecResult = { kind: 'rows', rows, columns };
            return out;
        }
        case 'export': {
            const entry = dbs.get(req.args.dbId);
            if (!entry) throw new Error('invalid dbId');
            // Returns a fresh Uint8Array containing the full DB image — usable
            // as a regular .sqlite file. Transferred (not copied) back via
            // postMessage's transfer list.
            return await pool!.exportFile(entry.path);
        }
        case 'close': {
            const entry = dbs.get(req.args.dbId);
            if (entry) {
                entry.db.close();
                dbs.delete(req.args.dbId);
            }
            return null;
        }
    }
}
