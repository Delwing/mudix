import type { ProfileVFS } from '../vfs/ProfileVFS';

// Mudlet's HTTP API is fire-and-forget: each function returns immediately,
// the actual request runs in the background, and completion/failure is
// reported via sysXxxHttpDone / sysXxxHttpError events. downloadFile also
// streams sysDownloadFileProgress while the body is being read.
//
// Event signatures (from the Mudlet manual; first arg in the handler is the
// event name itself, prepended by dispatchEventToFunctions in Other.lua —
// we pass only the trailing args here):
//   sysDownloadDone(saveTo, fileSize, response)
//   sysDownloadError(errorMessage, saveTo, url)
//   sysDownloadFileProgress(url, bytesDownloaded, totalBytes)
//   sysGetHttpDone(url, response)         sysGetHttpError(error, url)
//   sysPostHttpDone(url, response)        sysPostHttpError(error, url)
//   sysPutHttpDone(url, response)         sysPutHttpError(error, url)
//   sysDeleteHttpDone(url, response)      sysDeleteHttpError(error, url)
//   sysCustomHttpDone(url, response, method)
//   sysCustomHttpError(error, url, method)

type EmitFn = (event: string, args: unknown[]) => void;
type VFSGetter = () => ProfileVFS | null;

// A 1KB/sec download still emits ~10 progress events per second at 100ms;
// a 10MB/sec stream coalesces into the same cadence rather than firing
// thousands of events into Lua per second.
const PROGRESS_THROTTLE_MS = 100;

export class HttpService {
    constructor(
        private readonly emit: EmitFn,
        private readonly vfsGetter: VFSGetter,
    ) {}

    downloadFile(saveTo: string, url: string): void {
        this.runDownload(saveTo, url).catch(err => {
            this.emit('sysDownloadError', [errorMessage(err), saveTo, url]);
        });
    }

    getHTTP(url: string, headers?: Record<string, string>): void {
        void this.runRequest('GET', url, undefined, headers, 'sysGetHttpDone', 'sysGetHttpError');
    }

    postHTTP(data: string | null, url: string, headers?: Record<string, string>, file?: string): void {
        let body: BodyInit | undefined;
        try {
            body = this.bodyForUpload(data, file);
        } catch (err) {
            this.emit('sysPostHttpError', [errorMessage(err), url]);
            return;
        }
        void this.runRequest('POST', url, body, headers, 'sysPostHttpDone', 'sysPostHttpError');
    }

    putHTTP(data: string | null, url: string, headers?: Record<string, string>, file?: string): void {
        let body: BodyInit | undefined;
        try {
            body = this.bodyForUpload(data, file);
        } catch (err) {
            this.emit('sysPutHttpError', [errorMessage(err), url]);
            return;
        }
        void this.runRequest('PUT', url, body, headers, 'sysPutHttpDone', 'sysPutHttpError');
    }

    deleteHTTP(url: string, headers?: Record<string, string>): void {
        void this.runRequest('DELETE', url, undefined, headers, 'sysDeleteHttpDone', 'sysDeleteHttpError');
    }

    customHTTP(method: string, data: string | null, url: string, headers?: Record<string, string>): void {
        const body = data == null ? undefined : data;
        void this.runRequest(method, url, body, headers, 'sysCustomHttpDone', 'sysCustomHttpError', [method], [method]);
    }

    private async runDownload(saveTo: string, url: string): Promise<void> {
        const res = await fetch(url);
        if (!res.ok) {
            this.emit('sysDownloadError', [`HTTP ${res.status} ${res.statusText}`, saveTo, url]);
            return;
        }
        const data = await this.readWithProgress(res, url);
        const vfs = this.vfsGetter();
        if (!vfs) {
            this.emit('sysDownloadError', ['no profile VFS available', saveTo, url]);
            return;
        }
        try {
            vfs.writeBinaryFile(saveTo, data);
        } catch (err) {
            this.emit('sysDownloadError', [`save to '${saveTo}' failed: ${errorMessage(err)}`, saveTo, url]);
            return;
        }
        // Mudlet's third arg is the raw HTTP response body. We already wrote
        // it to disk; passing the bytes back as a Lua string would double the
        // memory pressure for a large download, so we send an empty string.
        this.emit('sysDownloadDone', [saveTo, data.byteLength, '']);
    }

    private async readWithProgress(res: Response, url: string): Promise<Uint8Array> {
        const total = Number(res.headers.get('Content-Length')) || 0;
        const reader = res.body?.getReader();
        if (!reader) {
            const buf = new Uint8Array(await res.arrayBuffer());
            this.emit('sysDownloadFileProgress', [url, buf.byteLength, total || buf.byteLength]);
            return buf;
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        let lastEmit = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
            const now = Date.now();
            if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
                this.emit('sysDownloadFileProgress', [url, received, total || -1]);
                lastEmit = now;
            }
        }
        // Final progress event so handlers see the terminal byte count even
        // if the body landed inside the throttle window.
        this.emit('sysDownloadFileProgress', [url, received, total || received]);
        const merged = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) {
            merged.set(c, off);
            off += c.byteLength;
        }
        return merged;
    }

    private bodyForUpload(data: string | null, file: string | undefined): BodyInit | undefined {
        if (file) {
            const vfs = this.vfsGetter();
            if (!vfs) throw new Error('no profile VFS available for file upload');
            // Copy into a fresh Uint8Array — ZenFS may return a Buffer slice
            // whose underlying ArrayBuffer extends past the file body.
            const raw = vfs.readBinaryFile(file);
            const fresh = new Uint8Array(raw.byteLength);
            fresh.set(raw);
            return fresh;
        }
        return data == null ? undefined : data;
    }

    private async runRequest(
        method: string,
        url: string,
        body: BodyInit | undefined,
        headers: Record<string, string> | undefined,
        doneEvent: string,
        errorEvent: string,
        extraDoneArgs: unknown[] = [],
        extraErrorArgs: unknown[] = [],
    ): Promise<void> {
        try {
            const res = await fetch(url, { method, body, headers });
            const text = await res.text();
            if (!res.ok) {
                this.emit(errorEvent, [`HTTP ${res.status} ${res.statusText}`, url, ...extraErrorArgs]);
                return;
            }
            this.emit(doneEvent, [url, text, ...extraDoneArgs]);
        } catch (err) {
            this.emit(errorEvent, [errorMessage(err), url, ...extraErrorArgs]);
        }
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
