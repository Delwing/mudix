// Driver page for the scripting-worker PoC. Vanilla TS — keeps the entry
// cheap and lets the comparison code stay obvious.
//
// Two hosts run the *same* host.ts setup: one inside a Worker, one on the
// main thread. The benchmarks invoke identical Lua so the only delta between
// the timings is the execution context.

import { PocWorkerClient } from './scripting/worker/poc/workerClient';
import { MainHostClient } from './scripting/worker/poc/mainHost';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
    document.getElementById(id) as T;

const out = $('out');

type Tag = 'worker' | 'main' | '';

function log(line: string, cls: 'ok' | 'err' | 'dim' | 'w' | 'm' | '' = '', tag: Tag = ''): void {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = tag ? `[${tag}] ${line}` : line;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
}

let worker: PocWorkerClient | null = null;
let main: MainHostClient | null = null;

function refreshButtons(): void {
    const wReady = worker !== null;
    const mReady = main !== null;
    ($('init-worker') as HTMLButtonElement).disabled = wReady;
    ($('init-main')   as HTMLButtonElement).disabled = mReady;
    ($('init-both')   as HTMLButtonElement).disabled = wReady && mReady;
    ($('shutdown')    as HTMLButtonElement).disabled = !wReady && !mReady;
    for (const id of [
        'bench-sql-worker', 'bench-vfs-worker', 'bench-bnd-worker', 'run-worker',
    ]) ($(id) as HTMLButtonElement).disabled = !wReady;
    for (const id of [
        'bench-sql-main', 'bench-vfs-main', 'bench-bnd-main', 'run-main',
    ]) ($(id) as HTMLButtonElement).disabled = !mReady;
    for (const id of [
        'bench-sql-cmp', 'bench-vfs-cmp', 'bench-bnd-cmp',
    ]) ($(id) as HTMLButtonElement).disabled = !(wReady && mReady);
}

// ── init ─────────────────────────────────────────────────────────────────────

async function initWorker(cid: string): Promise<void> {
    if (worker) return;
    log(`> init worker for "${cid}" …`, 'dim', 'worker');
    const t0 = performance.now();
    const w = new PocWorkerClient();
    try {
        const r = await w.init(cid);
        worker = w;
        const wall = performance.now() - t0;
        log(`✓ ready (${r.ms.toFixed(1)}ms inside worker, ${wall.toFixed(1)}ms wall)`, 'ok', 'worker');
    } catch (e) {
        log('✗ init failed: ' + errMsg(e), 'err', 'worker');
    }
}

async function initMain(cid: string): Promise<void> {
    if (main) return;
    log(`> init main-thread host for "${cid}" …`, 'dim', 'main');
    const t0 = performance.now();
    const m = new MainHostClient();
    try {
        const r = await m.init(cid);
        main = m;
        const wall = performance.now() - t0;
        log(`✓ ready (${r.ms.toFixed(1)}ms in host, ${wall.toFixed(1)}ms wall)`, 'ok', 'main');
    } catch (e) {
        log('✗ init failed: ' + errMsg(e), 'err', 'main');
    }
}

$('init-worker').addEventListener('click', () => withRefresh(initWorker(currentCid())));
$('init-main')  .addEventListener('click', () => withRefresh(initMain(currentCid())));
$('init-both')  .addEventListener('click', () => {
    const cid = currentCid();
    // Init both in parallel — even on init, the worker offloads its sqlite/zenfs
    // init from the main thread, so the two starts overlap.
    withRefresh(Promise.all([initWorker(cid), initMain(cid)]));
});

$('shutdown').addEventListener('click', async () => {
    log('> shutdown all', 'dim');
    try { await worker?.shutdown(); } catch (e) { log('worker shutdown error: ' + errMsg(e), 'err', 'worker'); }
    try { await main?.shutdown();   } catch (e) { log('main shutdown error: ' + errMsg(e), 'err', 'main'); }
    worker = null;
    main = null;
    refreshButtons();
});

$('clear').addEventListener('click', () => { out.textContent = ''; });

// ── benchmarks ───────────────────────────────────────────────────────────────

const benches = {
    sql: (n: number) => buildSqlBench(n),
    vfs: (n: number) => buildVfsBench(n),
    bnd: (n: number) => buildBoundaryBench(n),
} as const;

function wireBenchPair(kind: keyof typeof benches): void {
    $(`bench-${kind}-worker`).addEventListener('click', () => runOn('worker', benches[kind](rows()), `${kind} bench`));
    $(`bench-${kind}-main`)  .addEventListener('click', () => runOn('main',   benches[kind](rows()), `${kind} bench`));
    $(`bench-${kind}-cmp`)   .addEventListener('click', () => runBoth(benches[kind](rows()), `${kind} bench`));
}
wireBenchPair('sql');
wireBenchPair('vfs');
wireBenchPair('bnd');

$('run-worker').addEventListener('click', () => runOn('worker', luaSrc(), 'custom'));
$('run-main')  .addEventListener('click', () => runOn('main',   luaSrc(), 'custom'));

async function runOn(target: 'worker' | 'main', src: string, label: string): Promise<void> {
    const client = target === 'worker' ? worker : main;
    if (!client) return;
    log(`> ${label}`, 'dim', target);
    try {
        const res = await client.eval(src);
        for (const line of res.logs) log('  ' + line, target === 'worker' ? 'w' : 'm', target);
        log(`✓ eval ${res.ms.toFixed(1)}ms`, 'ok', target);
    } catch (e) {
        log('✗ ' + label + ' failed: ' + errMsg(e), 'err', target);
    }
}

async function runBoth(src: string, label: string): Promise<void> {
    if (!worker || !main) return;
    log(`> ${label} (parallel — wall times below are concurrent, not summed)`, 'dim');
    const wT0 = performance.now();
    const mT0 = performance.now();
    const [wRes, mRes] = await Promise.allSettled([worker.eval(src), main.eval(src)]);
    const wWall = performance.now() - wT0;
    const mWall = performance.now() - mT0;
    summarize('worker', wRes, wWall);
    summarize('main',   mRes, mWall);
    if (wRes.status === 'fulfilled' && mRes.status === 'fulfilled') {
        const ratio = wRes.value.ms / mRes.value.ms;
        log(`  ▶ worker/main eval ratio: ${ratio.toFixed(2)}× (eval-only, excludes postMessage)`, '');
    }
}

function summarize(
    tag: 'worker' | 'main',
    res: PromiseSettledResult<{ ms: number; logs: string[] }>,
    wallMs: number,
): void {
    if (res.status === 'rejected') {
        log('✗ failed: ' + errMsg(res.reason), 'err', tag);
        return;
    }
    for (const line of res.value.logs) log('  ' + line, tag === 'worker' ? 'w' : 'm', tag);
    if (tag === 'worker') {
        log(`✓ eval ${res.value.ms.toFixed(1)}ms · wall ${wallMs.toFixed(1)}ms (Δ ${(wallMs - res.value.ms).toFixed(1)}ms = postMessage round-trip)`, 'ok', tag);
    } else {
        log(`✓ eval ${res.value.ms.toFixed(1)}ms · wall ${wallMs.toFixed(1)}ms`, 'ok', tag);
    }
}

function currentCid(): string {
    return ($('cid') as HTMLInputElement).value.trim() || 'poc-1';
}
function rows(): number {
    return Number(($('rows') as HTMLInputElement).value) || 1000;
}
function luaSrc(): string {
    return ($('lua') as HTMLTextAreaElement).value;
}

function withRefresh<T>(p: Promise<T>): Promise<T> {
    return p.finally(refreshButtons);
}
function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// ── benchmark Lua sources ────────────────────────────────────────────────────

function buildSqlBench(rowCount: number): string {
    return `
local n = ${rowCount}
local path = 'poc/bench.sqlite'
mudix.vfs_unlink(path) -- start fresh

local t0 = mudix.now()
local id = mudix.db.open(path)
mudix.db.exec(id, 'CREATE TABLE rows(i INTEGER, txt TEXT)')
mudix.db.exec(id, 'BEGIN')
for i = 1, n do
    mudix.db.exec(id, "INSERT INTO rows VALUES(" .. i .. ", 'row-" .. i .. "')")
end
mudix.db.exec(id, 'COMMIT')
local t1 = mudix.now()
mudix.log(string.format('insert %d rows: %.1fms', n, t1 - t0))

local r = mudix.db.exec(id, 'SELECT count(*) FROM rows')
mudix.log('row count = ' .. tostring(r.rows[1][1]))

local t2 = mudix.now()
local sel = mudix.db.exec(id, 'SELECT i, txt FROM rows ORDER BY i')
local t3 = mudix.now()
mudix.log(string.format('select %d rows: %.1fms', n, t3 - t2))

mudix.db.close(id)
local t4 = mudix.now()
mudix.log(string.format('close+snapshot: %.1fms', t4 - t3))

local t5 = mudix.now()
local id2 = mudix.db.open(path)
local r2 = mudix.db.exec(id2, 'SELECT count(*) FROM rows')
local t6 = mudix.now()
mudix.log(string.format('reopen+select: %.1fms (count=%s)', t6 - t5, tostring(r2.rows[1][1])))
mudix.db.close(id2)
`;
}

function buildVfsBench(n: number): string {
    return `
local n = ${n}
mudix.vfs_mkdir('poc/files')

local t0 = mudix.now()
for i = 1, n do
    mudix.vfs_write('poc/files/' .. i .. '.txt', 'payload ' .. i .. ' ' .. string.rep('x', 64))
end
local t1 = mudix.now()
mudix.log(string.format('write %d files: %.1fms', n, t1 - t0))

local t2 = mudix.now()
local total = 0
for i = 1, n do
    total = total + #mudix.vfs_read('poc/files/' .. i .. '.txt')
end
local t3 = mudix.now()
mudix.log(string.format('read %d files (%d bytes total): %.1fms', n, total, t3 - t2))

local t4 = mudix.now()
local list = mudix.vfs_readdir('poc/files')
local count = 0
for _ in pairs(list) do count = count + 1 end
local t5 = mudix.now()
mudix.log(string.format('readdir: %.1fms (n=%d)', t5 - t4, count))
`;
}

function buildBoundaryBench(n: number): string {
    return `
local n = ${n}
local t0 = mudix.now()
local sum = 0
for i = 1, n do sum = sum + __now() end
local t1 = mudix.now()
mudix.log(string.format('%d empty Lua→JS calls: %.1fms (%.3fµs each)', n, t1 - t0, (t1 - t0) * 1000 / n))
`;
}

refreshButtons();
log('Two hosts available: a Worker host and a main-thread host. Both run the same wasmoon + sqlite + zenfs setup from host.ts; storage is isolated under different IDB stores so they do not share state.', 'dim');
log('Click "init both" to bring both up, then "▶ both" on any bench for a side-by-side comparison.', 'dim');
log('"eval" = time Lua took (boundary-crossing + work). "wall" = total round-trip the caller sees; worker wall − eval ≈ postMessage cost.', 'dim');
