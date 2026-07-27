import type { MudletMap, MudletMapHeader, MudletRoom } from 'mudlet-map-binary-reader';

type WorkerRes =
    | { id: number; ok: true; kind: 'parse'; map: MudletMap }
    | { id: number; ok: true; kind: 'header'; header: MudletMapHeader; totalRooms: number }
    | { id: number; ok: true; kind: 'rooms'; rooms: [number, MudletRoom][] }
    | { id: number; ok: true; kind: 'done' }
    | { id: number; ok: true; kind: 'serialize'; bytes: ArrayBuffer }
    | { id: number; ok: false; error: string };

/** Callbacks driving a streamed parse. `onHeader` fires once before any room,
 *  `onRooms` once per batch, in map order; the returned promise settles after
 *  the last batch has been handed over. */
export interface MapStreamSink {
    onHeader(header: MudletMapHeader, totalRooms: number): void;
    onRooms(rooms: [number, MudletRoom][]): void;
    /** Rooms ingested so far / the header's total (0 when the total is unknown). */
    onProgress?(loaded: number, total: number): void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const streams = new Map<number, { sink: MapStreamSink; loaded: number; total: number }>();

function failAll(err: Error): void {
    for (const slot of pending.values()) slot.reject(err);
    pending.clear();
    streams.clear();
}

function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./mapParser.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerRes>) => {
        const res = event.data;
        const slot = pending.get(res.id);
        if (!slot) return;
        if (!res.ok) {
            pending.delete(res.id);
            streams.delete(res.id);
            slot.reject(new Error(res.error));
            return;
        }
        const stream = streams.get(res.id);
        switch (res.kind) {
            case 'header':
                if (stream) {
                    stream.total = res.totalRooms;
                    stream.sink.onHeader(res.header, res.totalRooms);
                    stream.sink.onProgress?.(0, res.totalRooms);
                }
                return;
            case 'rooms':
                if (stream) {
                    stream.sink.onRooms(res.rooms);
                    stream.loaded += res.rooms.length;
                    stream.sink.onProgress?.(stream.loaded, stream.total);
                }
                return;
            case 'done':
                pending.delete(res.id);
                streams.delete(res.id);
                slot.resolve(undefined);
                return;
            default:
                pending.delete(res.id);
                slot.resolve(res.kind === 'parse' ? res.map : res.bytes);
        }
    });
    worker.addEventListener('error', () => {
        // Fail every in-flight request, then drop the worker so the next call
        // spins up a fresh one.
        failAll(new Error('map worker crashed'));
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
 * Streaming sibling of {@link parseMapInWorker}: the worker walks the map
 * room-by-room and pushes the header, then batches of rooms, into `sink`
 * instead of materialising the whole graph and cloning it back in one piece.
 * Peak memory is roughly halved (the graph no longer exists on both sides at
 * once) and the batch counter gives a progress signal for large maps.
 *
 * The buffer is transferred — the caller must not reuse it. Resolves once the
 * last batch has been delivered; rejects if the worker fails mid-stream, in
 * which case the sink has seen a partial map and the caller owns the cleanup.
 */
export function streamMapInWorker(buf: ArrayBuffer, sink: MapStreamSink): Promise<void> {
    const w = ensureWorker();
    const id = nextId++;
    return new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        streams.set(id, { sink, loaded: 0, total: 0 });
        w.postMessage({ id, kind: 'parseStream', buf }, [buf]);
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
