import { Buffer } from 'buffer';
import { readMapFromBuffer, type MudletMap } from 'mudlet-map-binary-reader';

type Req = { id: number; buf: ArrayBuffer };
type Res =
    | { id: number; ok: true; map: MudletMap }
    | { id: number; ok: false; error: string };

// `WebWorker` isn't in this project's tsconfig lib (it conflicts with DOM
// types); cast self to a minimal post-message shape rather than pull it in.
const ctx = self as unknown as { postMessage: (msg: unknown) => void };

self.addEventListener('message', (event: MessageEvent<Req>) => {
    const { id, buf } = event.data;
    try {
        const map = readMapFromBuffer(Buffer.from(buf));
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
        const res: Res = { id, ok: true, map };
        ctx.postMessage(res);
    } catch (err) {
        const res: Res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
        ctx.postMessage(res);
    }
});
