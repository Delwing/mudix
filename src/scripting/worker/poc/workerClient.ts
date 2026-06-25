// Main-thread RPC wrapper for the PoC scripting worker. One worker per client
// instance, FIFO promise-based RPC. Kept minimal — this is a PoC, not the
// shape the production wrapper would take.

import type { Req, Res, EvalRes, InitRes } from './protocol';

export class PocWorkerClient {
    private worker: Worker;
    private nextId = 1;
    private pending = new Map<
        number,
        { resolve: (v: Res) => void; reject: (e: Error) => void }
    >();

    constructor() {
        this.worker = new Worker(
            new URL('./scriptingWorker.ts', import.meta.url),
            { type: 'module', name: 'mudix-poc-scripting' },
        );
        this.worker.addEventListener('message', this.onMessage);
        this.worker.addEventListener('error', this.onError);
    }

    private onMessage = (ev: MessageEvent<Res>): void => {
        const res = ev.data;
        const slot = this.pending.get(res.id);
        if (!slot) return;
        this.pending.delete(res.id);
        if (res.type === 'err') slot.reject(new Error(res.error));
        else slot.resolve(res);
    };

    private onError = (ev: ErrorEvent): void => {
        const err = new Error(ev.message || 'worker error');
        for (const slot of this.pending.values()) slot.reject(err);
        this.pending.clear();
    };

    private send<T extends Res>(req: Req): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.pending.set(req.id, {
                resolve: resolve as (v: Res) => void,
                reject,
            });
            this.worker.postMessage(req);
        });
    }

    init(connectionId: string): Promise<InitRes> {
        return this.send<InitRes>({ type: 'init', id: this.nextId++, connectionId });
    }

    eval(lua: string): Promise<EvalRes> {
        return this.send<EvalRes>({ type: 'eval', id: this.nextId++, lua });
    }

    async shutdown(): Promise<void> {
        await this.send({ type: 'shutdown', id: this.nextId++ });
        this.worker.terminate();
    }
}
