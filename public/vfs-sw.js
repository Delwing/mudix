// Service worker that serves ProfileVFS-backed assets at /__vfs/<connectionId>/<path>.
// The page is the source of truth for VFS contents (the SW can't share folder
// handles or always-open the same IDB store), so each request round-trips to
// the client via MessageChannel.

const CACHE_NAME = 'mudix-vfs-v1';
// Scope path always ends with '/'. On a root-served deploy this is '/'; on
// GitHub Pages or any subpath deploy it's '/<repo>/'. The intercept prefix is
// '<scope>__vfs/' so SW-controlled URLs stay inside scope.
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const PREFIX = `${SCOPE_PATH}__vfs/`;
const READ_TIMEOUT_MS = 5000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (!url.pathname.startsWith(PREFIX)) return;
    event.respondWith(handle(event, url));
});

async function handle(event, url) {
    const rest = url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
    if (rest.length < 2) return new Response('Bad request', { status: 400 });
    const connectionId = decodeURIComponent(rest[0]);
    const filePath = '/' + rest.slice(1).map(decodeURIComponent).join('/');

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    const client = await pickClient(event);
    if (!client) {
        // Either there's no app tab loaded (direct URL hit in fresh tab) or
        // the only candidate is the tab currently navigating to this URL.
        return new Response('No app tab loaded; open mudix first', { status: 503 });
    }

    const reply = await ask(client, { type: 'vfs:read', connectionId, path: filePath });
    if (!reply || !reply.ok) {
        return new Response(reply?.error ?? 'Not found', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', reply.contentType || 'application/octet-stream');
    // Force a revalidation each navigation; the in-memory cache here is the
    // primary speedup and is invalidated on writes via postMessage.
    headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    const response = new Response(reply.bytes, { headers });
    cache.put(event.request, response.clone()).catch(() => {});
    return response;
}

async function pickClient(event) {
    // Prefer the client that issued this request — for sub-resource fetches
    // that's the loaded app page, which can reply immediately.
    const requestingId = event.clientId || event.resultingClientId || '';
    if (requestingId) {
        const c = await self.clients.get(requestingId);
        if (c && isUsable(c)) return c;
    }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const usable = all.filter(isUsable);
    return usable.find((c) => c.focused) ?? usable[0] ?? null;
}

// Skip clients that are themselves navigating to a /__vfs/ URL — those are
// fresh tabs in the middle of loading the SW response; they have no JS running
// and can't reply, so picking one guarantees a timeout.
function isUsable(client) {
    try {
        return !new URL(client.url).pathname.startsWith(PREFIX);
    } catch {
        return false;
    }
}

function ask(client, message) {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => {
            channel.port1.close();
            resolve({ ok: false, error: 'timeout' });
        }, READ_TIMEOUT_MS);
        channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(e.data);
        };
        client.postMessage(message, [channel.port2]);
    });
}

self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'vfs:invalidate') {
        event.waitUntil(invalidate(data));
    }
});

async function invalidate({ connectionId, path }) {
    if (!connectionId) {
        await caches.delete(CACHE_NAME);
        return;
    }
    const cache = await caches.open(CACHE_NAME);
    const connPrefix = `${PREFIX}${encodeURIComponent(connectionId)}/`;
    const keys = await cache.keys();
    if (path) {
        const segs = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
        const target = `${connPrefix}${segs}`;
        await Promise.all(
            keys
                .filter((req) => new URL(req.url).pathname === target)
                .map((req) => cache.delete(req)),
        );
        return;
    }
    await Promise.all(
        keys
            .filter((req) => new URL(req.url).pathname.startsWith(connPrefix))
            .map((req) => cache.delete(req)),
    );
}
