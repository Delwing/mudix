import type { MudletMap } from 'mudlet-map-binary-reader';

type WorkerRes =
    | { id: number; ok: true; kind: 'parse'; map: MudletMap }
    | { id: number; ok: true; kind: 'serialize'; bytes: ArrayBuffer }
    | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./mapParser.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerRes>) => {
        const res = event.data;
        const slot = pending.get(res.id);
        if (!slot) return;
        pending.delete(res.id);
        if (res.ok) slot.resolve(res.kind === 'parse' ? res.map : res.bytes);
        else slot.reject(new Error(res.error));
    });
    worker.addEventListener('error', () => {
        // Fail every in-flight request, then drop the worker so the next call
        // spins up a fresh one.
        for (const slot of pending.values()) slot.reject(new Error('map worker crashed'));
        pending.clear();
        worker?.terminate();
        worker = null;
    });
    return worker;
}

/**
 * Parse a Mudlet binary map off the main thread. The buffer is transferred —
 * caller must not reuse it after the call. Resolves with the parsed MudletMap
 * (deep-cloned by structured-clone on its way back).
 */
export function parseMapInWorker(buf: ArrayBuffer): Promise<MudletMap> {
    const w = ensureWorker();
    const id = nextId++;
    return new Promise<MudletMap>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        w.postMessage({ id, kind: 'parse', buf }, [buf]);
    });
}

/**
 * Serialise a MudletMap to the Mudlet binary `.dat` format off the main thread.
 * The map is structured-cloned to the worker (so the caller's object isn't
 * touched); the resulting bytes are transferred back as a standalone
 * ArrayBuffer the caller owns.
 */
export function serializeMapInWorker(map: MudletMap): Promise<ArrayBuffer> {
    const w = ensureWorker();
    const id = nextId++;
    return new Promise<ArrayBuffer>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        w.postMessage({ id, kind: 'serialize', map });
    });
}
