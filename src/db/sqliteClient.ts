// Vite ?worker import — bundles sqliteWorker.ts as a separate worker chunk.
import SqliteWorker from './sqliteWorker?worker';
import type {SqlValue} from '@sqlite.org/sqlite-wasm';

type ExecResult =
    | { kind: 'rows'; rows: SqlValue[][]; columns: string[] }
    | { kind: 'changes'; changes: number };

interface Pending {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
}

export class SqliteClient {
    private readonly worker: Worker;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;

    constructor() {
        this.worker = new SqliteWorker();
        this.worker.onmessage = (e: MessageEvent) => {
            const msg = e.data as { id: number; ok: boolean; result?: unknown; error?: string };
            const p = this.pending.get(msg.id);
            if (!p) return;
            this.pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error ?? 'unknown sqlite worker error'));
        };
        this.worker.onerror = (e: ErrorEvent) => {
            console.error('[sqlite-worker]', e.message);
        };
    }

    private call<T>(op: string, args: unknown): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
            this.worker.postMessage({ id, op, args });
        });
    }

    async open(path: string, preload?: Uint8Array): Promise<number> {
        const r = await this.call<{ dbId: number }>('open', { path, preload });
        return r.dbId;
    }

    async exec(dbId: number, sql: string): Promise<ExecResult> {
        return await this.call<ExecResult>('exec', { dbId, sql });
    }

    async exportFile(dbId: number): Promise<Uint8Array> {
        return await this.call<Uint8Array>('export', { dbId });
    }

    async close(dbId: number): Promise<void> {
        await this.call<null>('close', { dbId });
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
