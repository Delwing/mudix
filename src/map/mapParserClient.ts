import type { MudletMap } from 'mudlet-map-binary-reader';

type WorkerRes =
    | { id: number; ok: true; map: MudletMap }
    | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (m: MudletMap) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./mapParser.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerRes>) => {
        const res = event.data;
        const slot = pending.get(res.id);
        if (!slot) return;
        pending.delete(res.id);
        if (res.ok) slot.resolve(res.map);
        else slot.reject(new Error(res.error));
    });
    worker.addEventListener('error', () => {
        // Fail every in-flight request, then drop the worker so the next call
        // spins up a fresh one.
        for (const slot of pending.values()) slot.reject(new Error('map parser worker crashed'));
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
        pending.set(id, { resolve, reject });
        w.postMessage({ id, buf }, [buf]);
    });
}
