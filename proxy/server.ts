import * as http from 'http';
import * as net from 'net';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
};

// Hop-by-hop headers and a few that the browser auto-sets on cross-origin
// requests but the upstream server should not see (Origin/Referer leak the
// app URL; Cookie carries the user's session for *our* origin, never theirs).
const STRIPPED_REQUEST_HEADERS = new Set([
    'host', 'origin', 'referer', 'cookie', 'connection',
    'keep-alive', 'transfer-encoding', 'upgrade', 'content-length',
]);

const server = http.createServer(async (req, res) => {
    const reqUrl = req.url ?? '/';
    const parsed = new URL(reqUrl, 'http://localhost');

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const target = parsed.searchParams.get('url');
    if (target) {
        await forwardHttp(req, res, target);
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
    res.end('MUD Telnet-to-WebSocket proxy\n');
});

async function forwardHttp(req: http.IncomingMessage, res: http.ServerResponse, target: string): Promise<void> {
    let targetUrl: URL;
    try {
        targetUrl = new URL(target);
    } catch {
        res.writeHead(400, CORS_HEADERS);
        res.end('Invalid target URL');
        return;
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
        res.writeHead(400, CORS_HEADERS);
        res.end('Only http(s) targets are supported');
        return;
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (v == null) continue;
        if (STRIPPED_REQUEST_HEADERS.has(k.toLowerCase())) continue;
        headers[k] = Array.isArray(v) ? v.join(',') : String(v);
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const body = (method === 'GET' || method === 'HEAD') ? undefined : await readRequestBody(req);

    let upstream: Response;
    try {
        upstream = await fetch(targetUrl.toString(), { method, headers, body, redirect: 'follow' });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(502, CORS_HEADERS);
        res.end(`Proxy fetch failed: ${message}`);
        return;
    }

    // Strip CORS headers (we set our own) and any header that describes the
    // *transport* of the upstream body. Node's fetch auto-decodes gzip/br/
    // deflate responses, so forwarding the upstream Content-Encoding makes
    // the browser try to decompress already-decompressed bytes — silently
    // mangling binary downloads. Content-Length / Transfer-Encoding similarly
    // describe the on-wire shape, not the bytes we re-emit chunked below.
    const outHeaders: Record<string, string> = {};
    upstream.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk.startsWith('access-control-')) return;
        if (lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') return;
        outHeaders[k] = v;
    });
    Object.assign(outHeaders, CORS_HEADERS);
    res.writeHead(upstream.status, outHeaders);

    if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) res.write(Buffer.from(value));
            }
        } catch (err) {
            console.error('[proxy] response stream error:', err);
        }
    }
    res.end();
}

async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

const wss = new WebSocketServer({ server });

// WebSocket close.reason is capped at 123 bytes by the spec; trim defensively.
function clipReason(text: string): string {
    return text.length > 120 ? text.slice(0, 120) : text;
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.close(code, clipReason(reason)); } catch { /* ignore */ }
    }
}

wss.on('connection', (ws, req) => {
    const reqUrl = req.url ?? '/';
    const params = new URL(reqUrl, 'http://localhost').searchParams;
    const host = params.get('host');
    const port = parseInt(params.get('port') ?? '23', 10);

    if (!host) {
        ws.close(1008, 'Missing required query param: host');
        return;
    }

    if (isNaN(port) || port < 1 || port > 65535) {
        ws.close(1008, 'Invalid port');
        return;
    }

    console.log(`[proxy] Connecting to ${host}:${port}`);

    const tcp = net.connect(port, host);
    let tcpConnected = false;

    tcp.on('connect', () => {
        tcpConnected = true;
        console.log(`[proxy] Connected to ${host}:${port}`);
    });

    tcp.on('data', (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk.toString('base64'));
        }
    });

    tcp.on('error', (err: NodeJS.ErrnoException) => {
        console.error(`[proxy] TCP error for ${host}:${port}: ${err.message}`);
        const phase = tcpConnected ? 'TCP error' : `connect to ${host}:${port} failed`;
        const reason = err.code ? `Proxy: ${phase}: ${err.code}` : `Proxy: ${phase}: ${err.message}`;
        safeClose(ws, 1011, reason);
    });

    tcp.on('close', () => {
        console.log(`[proxy] TCP closed for ${host}:${port}`);
        safeClose(ws, 1000, 'TCP connection closed');
    });

    ws.on('message', (data) => {
        if (!tcp.writable) return;
        try {
            tcp.write(Buffer.from(data.toString(), 'base64'));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[proxy] Failed to forward message:', message);
            safeClose(ws, 1011, `Proxy: TCP write error: ${message}`);
            tcp.destroy();
        }
    });

    ws.on('close', () => {
        console.log(`[proxy] WebSocket closed for ${host}:${port}`);
        tcp.destroy();
    });

    ws.on('error', (err) => {
        console.error(`[proxy] WebSocket error: ${err.message}`);
        tcp.destroy();
    });
});

server.listen(PORT, () => {
    console.log(`[proxy] Listening on ws://localhost:${PORT}`);
    console.log(`[proxy] Usage: connect with ws://localhost:${PORT}?host=<mud-host>&port=<mud-port>`);
    console.log(`[proxy] Example: ws://localhost:${PORT}?host=aardmud.org&port=23`);
});
