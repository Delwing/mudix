// Main-thread host that exposes the same API as PocWorkerClient. Same
// wasmoon, same sqlite, same ZenFS — just no Worker hop. The PoC UI can
// point its benchmarks at either side and the timings are directly
// comparable.

import { createHost, type Host } from './host';
import type { EvalRes, InitRes } from './protocol';

export class MainHostClient {
    private host: Host | null = null;
    private nextId = 1;

    async init(connectionId: string): Promise<InitRes> {
        const id = this.nextId++;
        const t0 = performance.now();
        this.host = await createHost(connectionId, 'mudix_poc_main');
        return { type: 'init-ok', id, ms: performance.now() - t0 };
    }

    eval(lua: string): Promise<EvalRes> {
        const id = this.nextId++;
        if (!this.host) return Promise.reject(new Error('main host not initialized'));
        try {
            const r = this.host.eval(lua);
            return Promise.resolve({
                type: 'eval-ok',
                id,
                result: r.result,
                ms: r.ms,
                logs: r.logs,
            });
        } catch (e) {
            return Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }
    }

    async shutdown(): Promise<void> {
        try { this.host?.shutdown(); } catch { /* ignore */ }
        this.host = null;
    }
}
