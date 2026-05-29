import { Buffer } from 'buffer';
import { readMapFromBuffer, writeMapToBuffer, type MudletMap } from 'mudlet-map-binary-reader';

type Req =
    | { id: number; kind: 'parse'; buf: ArrayBuffer }
    | { id: number; kind: 'serialize'; map: MudletMap };
type Res =
    | { id: number; ok: true; kind: 'parse'; map: MudletMap }
    | { id: number; ok: true; kind: 'serialize'; bytes: ArrayBuffer }
    | { id: number; ok: false; error: string };

// `WebWorker` isn't in this project's tsconfig lib (it conflicts with DOM
// types); cast self to a minimal post-message shape rather than pull it in.
const ctx = self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void };

self.addEventListener('message', (event: MessageEvent<Req>) => {
    const req = event.data;
    try {
        if (req.kind === 'serialize') {
            // Inverse of the parse-side conversion below: label pixMaps live in
            // the store as base64 strings (cheap to structured-clone and JSON),
            // but writeMapToBuffer needs the raw QByteArray bytes. Without this,
            // qtdatastream's Buffer.concat throws "list argument must be an Array
            // of Buffers" and the ENTIRE map save fails (zoom, edits, hidden
            // rooms — everything that round-trips through saveMap).
            for (const arr of Object.values(req.map.labels ?? {})) {
                for (const label of arr) {
                    const pm = label.pixMap as unknown;
                    if (typeof pm === 'string') {
                        (label as { pixMap: unknown }).pixMap = Buffer.from(pm, 'base64');
                    }
                }
            }
            // Serialise the map binary off the main thread. writeMapToBuffer
            // returns a Buffer backed by the polyfill's pool, so copy into a
            // standalone ArrayBuffer we can transfer back without dragging the
            // whole pool along.
            const buf = writeMapToBuffer(req.map);
            const out = new ArrayBuffer(buf.byteLength);
            new Uint8Array(out).set(buf);
            const res: Res = { id: req.id, ok: true, kind: 'serialize', bytes: out };
            ctx.postMessage(res, [out]);
            return;
        }
        const map = readMapFromBuffer(Buffer.from(req.buf));
        // Convert label pixmaps from Buffer to base64 string before posting
        // back. Without this, the main thread's later lodash.cloneDeep in
        // readerExport walks each Buffer via cloneArrayBuffer — ~350ms each
        // on label-heavy maps, paid on every renderer refresh. Strings are
        // structurally cheap to clone.
        for (const arr of Object.values(map.labels ?? {})) {
            for (const label of arr) {
                const pm = label.pixMap as unknown;
                if (pm && typeof pm !== 'string') {
                    try { label.pixMap = Buffer.from(pm as Uint8Array).toString('base64'); }
                    catch { label.pixMap = ''; }
                }
            }
        }
        const res: Res = { id: req.id, ok: true, kind: 'parse', map };
        ctx.postMessage(res);
    } catch (err) {
        const res: Res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
        ctx.postMessage(res);
    }
});
