/**
 * Fetch a package file from a remote URL, falling back through the configured
 * proxy on CORS / network failures. Mirrors the proxy logic in HttpService and
 * packageRepository — duplicated rather than imported to keep this module
 * focused on the small concern of "download bytes for a package install".
 */

export async function downloadFromUrl(url: string, proxyUrlRaw?: string): Promise<Uint8Array> {
    const res = await fetchWithProxyFallback(url, proxyUrlRaw);
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
    return new Uint8Array(await res.arrayBuffer());
}

async function fetchWithProxyFallback(target: string, proxyUrlRaw?: string): Promise<Response> {
    try {
        return await fetch(target);
    } catch (err) {
        const proxy = normalizeProxyBase(proxyUrlRaw);
        if (!proxy) throw err;
        return fetch(`${proxy}/?url=${encodeURIComponent(target)}`);
    }
}

function normalizeProxyBase(raw: string | undefined): string | undefined {
    const trimmed = raw?.trim().replace(/\/$/, '');
    if (!trimmed) return undefined;
    if (trimmed.startsWith('wss://')) return 'https://' + trimmed.slice(6);
    if (trimmed.startsWith('ws://'))  return 'http://'  + trimmed.slice(5);
    return trimmed;
}

/** Pull the trailing path segment out of a URL, falling back when the URL is malformed. */
export function filenameFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const segment = parsed.pathname.split('/').filter(Boolean).pop();
        if (segment) return decodeURIComponent(segment);
    } catch { /* fall through */ }
    const stripped = url.split(/[?#]/, 1)[0];
    const segment = stripped.split('/').pop();
    return segment || 'package.xml';
}

export interface ClientGuiPayload {
    url: string;
    version?: string;
}

/**
 * Decode a `Client.GUI` GMCP payload. Mudlet historically supports two shapes:
 *   - a `{ url, version }` JSON object (current MMP-style format)
 *   - a string `"<url>\n<version>"` (legacy)
 * Returns null when neither shape applies or the URL is empty.
 */
export function parseClientGuiPayload(value: unknown): ClientGuiPayload | null {
    if (value && typeof value === 'object') {
        const obj = value as { url?: unknown; version?: unknown };
        if (typeof obj.url === 'string' && obj.url.length > 0) {
            const out: ClientGuiPayload = { url: obj.url };
            if (typeof obj.version === 'string' && obj.version.length > 0) out.version = obj.version;
            return out;
        }
        return null;
    }
    if (typeof value === 'string') {
        const [url, version] = value.split(/\r?\n/, 2);
        const trimmedUrl = url?.trim();
        if (!trimmedUrl) return null;
        const out: ClientGuiPayload = { url: trimmedUrl };
        const v = version?.trim();
        if (v) out.version = v;
        return out;
    }
    return null;
}
