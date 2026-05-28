// Shared message types between the PoC scripting worker and its main-thread
// client. Kept in a separate module so the .worker.ts file doesn't accidentally
// drag DOM-only main-thread modules in.

export type InitReq = {
    type: 'init';
    id: number;
    connectionId: string;
};

export type EvalReq = {
    type: 'eval';
    id: number;
    lua: string;
};

export type ShutdownReq = { type: 'shutdown'; id: number };

export type Req = InitReq | EvalReq | ShutdownReq;

export type InitRes = {
    type: 'init-ok';
    id: number;
    ms: number;
};

export type EvalRes = {
    type: 'eval-ok';
    id: number;
    result: unknown;
    ms: number;
    logs: string[];
};

export type ErrRes = {
    type: 'err';
    id: number;
    error: string;
};

export type ShutdownRes = { type: 'shutdown-ok'; id: number };

export type Res = InitRes | EvalRes | ErrRes | ShutdownRes;
