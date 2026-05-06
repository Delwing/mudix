import { connect } from 'cloudflare:sockets';

function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// WebSocket close.reason has a 123-byte limit; trimming defensively.
function clipReason(text) {
    const str = String(text ?? '').slice(0, 120);
    return str.length === 0 ? 'unknown error' : str;
}

function describeError(err) {
    if (!err) return 'unknown error';
    if (err.message) return err.message;
    return String(err);
}

function safeClose(server, code, reason) {
    if (server.readyState === WebSocket.OPEN) {
        try { server.close(code, clipReason(reason)); } catch { /* ignore */ }
    }
}

export default {
    async fetch(request) {
        const url = new URL(request.url);

        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
            return new Response('MUD Telnet-to-WebSocket proxy (Cloudflare Worker)\n', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
            });
        }

        const host = url.searchParams.get('host');
        const portStr = url.searchParams.get('port') ?? '23';
        const port = parseInt(portStr, 10);

        if (!host) {
            return new Response('Missing required query param: host', { status: 400 });
        }
        if (isNaN(port) || port < 1 || port > 65535) {
            return new Response('Invalid port', { status: 400 });
        }

        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        server.accept();

        let tcpClosed = false;
        let tcpSocket;
        try {
            tcpSocket = connect({ hostname: host, port });
        } catch (err) {
            // Synchronous failure (e.g. invalid hostname format) — surface and bail.
            safeClose(server, 1011, `Proxy: ${describeError(err)}`);
            return new Response(null, { status: 101, webSocket: client });
        }

        // The TCP `opened` promise rejects on connect failures (DNS, refused,
        // network unreachable). Without this, those errors used to be swallowed
        // and the client would only see a generic 1006 close.
        tcpSocket.opened.catch((err) => {
            tcpClosed = true;
            safeClose(server, 1011, `Proxy: connect to ${host}:${port} failed: ${describeError(err)}`);
        });

        const writer = tcpSocket.writable.getWriter();

        // TCP → WebSocket
        (async () => {
            const reader = tcpSocket.readable.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (server.readyState === WebSocket.OPEN) {
                        server.send(uint8ToBase64(value));
                    }
                }
                // Clean EOF — TCP peer closed the connection normally.
                tcpClosed = true;
                safeClose(server, 1000, 'TCP connection closed');
            } catch (err) {
                tcpClosed = true;
                safeClose(server, 1011, `Proxy: TCP read error: ${describeError(err)}`);
            }
        })();

        // WebSocket → TCP
        server.addEventListener('message', async (event) => {
            if (tcpClosed) return;
            try {
                const bytes = Uint8Array.from(atob(event.data), c => c.charCodeAt(0));
                await writer.write(bytes);
            } catch (err) {
                tcpClosed = true;
                safeClose(server, 1011, `Proxy: TCP write error: ${describeError(err)}`);
            }
        });

        server.addEventListener('close', () => {
            if (!tcpClosed) writer.close().catch(() => {});
        });

        server.addEventListener('error', () => {
            if (!tcpClosed) writer.abort().catch(() => {});
        });

        return new Response(null, { status: 101, webSocket: client });
    },
};
