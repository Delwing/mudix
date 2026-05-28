// Driver page for the scripting-worker PoC. No React — vanilla TS so the
// PoC entry stays cheap to load and easy to read.
import { PocWorkerClient } from './scripting/worker/poc/workerClient';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
    document.getElementById(id) as T;

const out = $('out');

function log(line: string, cls: 'ok' | 'err' | 'dim' | '' = ''): void {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = line;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
}

let client: PocWorkerClient | null = null;

function setReady(ready: boolean): void {
    for (const id of ['bench-sql', 'bench-vfs', 'bench-boundary', 'run', 'shutdown']) {
        ($(id) as HTMLButtonElement).disabled = !ready;
    }
    ($('init') as HTMLButtonElement).disabled = ready;
}

$('init').addEventListener('click', async () => {
    if (client) return;
    const cid = ($('cid') as HTMLInputElement).value.trim() || 'poc-1';
    log(`> init worker for "${cid}" …`, 'dim');
    client = new PocWorkerClient();
    try {
        const r = await client.init(cid);
        log(`✓ init in ${r.ms.toFixed(1)}ms (wasmoon + sqlite + zenfs all in worker)`, 'ok');
        setReady(true);
    } catch (e) {
        log('✗ init failed: ' + errMsg(e), 'err');
        client = null;
    }
});

$('shutdown').addEventListener('click', async () => {
    if (!client) return;
    log('> shutdown', 'dim');
    try { await client.shutdown(); } catch (e) { log('shutdown error: ' + errMsg(e), 'err'); }
    client = null;
    setReady(false);
});

$('run').addEventListener('click', async () => {
    if (!client) return;
    const src = ($('lua') as HTMLTextAreaElement).value;
    await runLua(src, 'custom');
});

$('bench-sql').addEventListener('click', async () => {
    if (!client) return;
    const rows = Number(($('rows') as HTMLInputElement).value) || 1000;
    await runLua(buildSqlBench(rows), `sqlite bench (${rows} rows)`);
});

$('bench-vfs').addEventListener('click', async () => {
    if (!client) return;
    const n = Number(($('rows') as HTMLInputElement).value) || 1000;
    await runLua(buildVfsBench(n), `vfs bench (${n} files)`);
});

$('bench-boundary').addEventListener('click', async () => {
    if (!client) return;
    const n = Number(($('rows') as HTMLInputElement).value) || 1000;
    await runLua(buildBoundaryBench(n), `boundary bench (${n} calls)`);
});

$('clear').addEventListener('click', () => { out.textContent = ''; });

async function runLua(src: string, label: string): Promise<void> {
    if (!client) return;
    log(`> ${label}`, 'dim');
    try {
        const res = await client.eval(src);
        for (const line of res.logs) log('  ' + line);
        log(`✓ ${label} — worker eval ${res.ms.toFixed(1)}ms`, 'ok');
        if (res.result !== undefined && res.result !== null) {
            log('  result: ' + JSON.stringify(res.result));
        }
    } catch (e) {
        log('✗ ' + label + ' failed: ' + errMsg(e), 'err');
    }
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function buildSqlBench(rows: number): string {
    return `
local n = ${rows}
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

mudix.db.close(id)            -- snapshots to vfs
local t4 = mudix.now()
mudix.log(string.format('close+snapshot: %.1fms', t4 - t3))

-- reopen from VFS and re-read
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
-- list is 1-indexed from the bridge
local count = 0
for _ in pairs(list) do count = count + 1 end
local t5 = mudix.now()
mudix.log(string.format('readdir: %.1fms (n=%d)', t5 - t4, count))
`;
}

function buildBoundaryBench(n: number): string {
    // Pure Lua → JS boundary: __now() is the cheapest possible crossing.
    // Useful as a baseline against the SQL / VFS bench so we know how much of
    // the cost is the boundary itself vs. the actual work.
    return `
local n = ${n}
local t0 = mudix.now()
local sum = 0
for i = 1, n do sum = sum + __now() end
local t1 = mudix.now()
mudix.log(string.format('%d empty Lua→JS calls: %.1fms (%.3fµs each)', n, t1 - t0, (t1 - t0) * 1000 / n))
`;
}

setReady(false);
log('PoC harness ready. Click "init worker" to spin up wasmoon + sqlite + zenfs entirely in a Web Worker.', 'dim');
log('Storage is isolated under IDB store "mudix_poc_<connectionId>" — separate from your real profiles.', 'dim');
