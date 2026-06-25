/// <reference lib="webworker" />

// Worker shell around the shared host. The actual wasmoon / sqlite / ZenFS
// setup and the __sql_* / __vfs_* Lua bridge live in host.ts so the main-
// thread comparison harness runs the exact same code path.

import { createHost, type Host } from './host';
import type {
    Req,
    Res,
    InitRes,
    EvalRes,
    ErrRes,
    ShutdownRes,
} from './protocol';

const ctx = self as unknown as {
    postMessage: (m: Res) => void;
    addEventListener: (t: 'message', fn: (e: MessageEvent<Req>) => void) => void;
};

let host: Host | null = null;

async function init(req: { id: number; connectionId: string }): Promise<void> {
    const t0 = performance.now();
    try {
        host = await createHost(req.connectionId, 'mudix_poc_worker');
        const res: InitRes = {
            type: 'init-ok',
            id: req.id,
            ms: performance.now() - t0,
        };
        ctx.postMessage(res);
    } catch (e) {
        ctx.postMessage(toErr(req.id, e));
    }
}

function evalLua(req: { id: number; lua: string }): void {
    if (!host) {
        ctx.postMessage(toErr(req.id, 'worker not initialized'));
        return;
    }
    try {
        const r = host.eval(req.lua);
        const res: EvalRes = {
            type: 'eval-ok',
            id: req.id,
            result: r.result,
            ms: r.ms,
            logs: r.logs,
        };
        ctx.postMessage(res);
    } catch (e) {
        ctx.postMessage(toErr(req.id, e));
    }
}

function shutdown(req: { id: number }): void {
    try { host?.shutdown(); } catch (e) { console.warn('[poc shutdown]', e); }
    host = null;
    const res: ShutdownRes = { type: 'shutdown-ok', id: req.id };
    ctx.postMessage(res);
}

function toErr(id: number, e: unknown): ErrRes {
    return {
        type: 'err',
        id,
        error: e instanceof Error ? e.message + '\n' + (e.stack ?? '') : String(e),
    };
}

ctx.addEventListener('message', (event: MessageEvent<Req>) => {
    const req = event.data;
    switch (req.type) {
        case 'init': void init(req); break;
        case 'eval': evalLua(req); break;
        case 'shutdown': shutdown(req); break;
    }
});
