import * as http from 'http';
import * as net from 'net';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MUD Telnet-to-WebSocket proxy\n');
});

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
