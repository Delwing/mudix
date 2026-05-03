import { connect } from 'cloudflare:sockets';

function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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
        const tcpSocket = connect({ hostname: host, port });
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
            } catch {
                // TCP error or closed
            } finally {
                tcpClosed = true;
                if (server.readyState === WebSocket.OPEN) {
                    server.close(1000, 'TCP connection closed');
                }
            }
        })();

        // WebSocket → TCP
        server.addEventListener('message', async (event) => {
            if (tcpClosed) return;
            try {
                const bytes = Uint8Array.from(atob(event.data), c => c.charCodeAt(0));
                await writer.write(bytes);
            } catch {
                // ignore malformed frames
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
