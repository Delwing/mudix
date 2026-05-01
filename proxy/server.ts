import * as http from 'http';
import * as net from 'net';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MUD Telnet-to-WebSocket proxy\n');
});

const wss = new WebSocketServer({ server });

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

    tcp.on('connect', () => {
        console.log(`[proxy] Connected to ${host}:${port}`);
    });

    tcp.on('data', (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk.toString('base64'));
        }
    });

    tcp.on('error', (err) => {
        console.error(`[proxy] TCP error: ${err.message}`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, err.message);
        }
    });

    tcp.on('close', () => {
        console.log(`[proxy] TCP closed for ${host}:${port}`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'TCP connection closed');
        }
    });

    ws.on('message', (data) => {
        if (!tcp.writable) return;
        try {
            tcp.write(Buffer.from(data.toString(), 'base64'));
        } catch (err) {
            console.error('[proxy] Failed to forward message:', err);
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
