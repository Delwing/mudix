/**
 * Minimal Cloudflare API client for the proxy-deploy wizard.
 *
 * The wizard uses the user's API token to:
 *   1. List accounts the token has access to (verifyToken / listAccounts)
 *   2. Upload the proxy worker script (deployWorker)
 *   3. Enable the *.workers.dev route on it (enableWorkersDevRoute)
 *   4. Look up the account's workers.dev subdomain (getWorkersSubdomain)
 *
 * Cloudflare's API rejects cross-origin browser requests, so every call is
 * tunneled through a relay Worker's HTTP-forward mode (`?url=<target>`). The
 * relay adds CORS headers and strips Origin/Referer/Cookie before forwarding;
 * the Authorization header is preserved.
 *
 * The token never leaves component state — it's consumed once per deploy and
 * never persisted.
 */

import { DEFAULT_PROXY_URL } from '../storage';

const API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Build a relay URL that the proxy Worker will forward to. The default proxy
 * is a wss:// URL for WebSockets — for HTTP forwarding we use the same host
 * over https.
 */
function relayUrl(target: string, proxyBase?: string): string {
    const base = (proxyBase || DEFAULT_PROXY_URL)
        .replace(/^wss:/i, 'https:')
        .replace(/^ws:/i, 'http:')
        .replace(/\/$/, '');
    return `${base}/?url=${encodeURIComponent(target)}`;
}

// Pin a compat date so the Worker has stable runtime semantics. Bump cautiously.
const COMPAT_DATE = '2024-09-23';

export interface CloudflareAccount {
    id: string;
    name: string;
}

export class CloudflareApiError extends Error {
    readonly status: number;
    readonly cfErrors?: { code: number; message: string }[];

    constructor(message: string, status: number, cfErrors?: { code: number; message: string }[]) {
        super(message);
        this.name = 'CloudflareApiError';
        this.status = status;
        this.cfErrors = cfErrors;
    }
}

interface CfEnvelope<T> {
    success: boolean;
    result: T;
    errors?: { code: number; message: string }[];
    messages?: { code: number; message: string }[];
}

async function parseEnvelope<T>(res: Response): Promise<T> {
    let body: CfEnvelope<T> | undefined;
    try {
        body = await res.json() as CfEnvelope<T>;
    } catch {
        // Non-JSON response (rare for the CF API but possible on 5xx).
        throw new CloudflareApiError(
            `Cloudflare API returned ${res.status} ${res.statusText}`,
            res.status,
        );
    }
    if (!res.ok || !body.success) {
        const summary = body.errors?.[0]?.message
            ?? `Cloudflare API returned ${res.status} ${res.statusText}`;
        throw new CloudflareApiError(summary, res.status, body.errors);
    }
    return body.result;
}

function authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
}

/**
 * Lists accounts visible to the token. Doubles as a token-validity check:
 * an invalid token returns a Cloudflare error envelope which we surface.
 */
export async function listAccounts(token: string, proxyBase?: string): Promise<CloudflareAccount[]> {
    const res = await fetch(relayUrl(`${API_BASE}/accounts`, proxyBase), {
        headers: { ...authHeaders(token), Accept: 'application/json' },
    });
    const result = await parseEnvelope<CloudflareAccount[]>(res);
    return result.map(a => ({ id: a.id, name: a.name }));
}

/**
 * Uploads a Worker script via the multipart "modules" format. The script is
 * sent as an ES module so `import { connect } from 'cloudflare:sockets'` works.
 */
export async function deployWorker(
    token: string,
    accountId: string,
    scriptName: string,
    scriptSource: string,
    proxyBase?: string,
): Promise<void> {
    const metadata = {
        main_module: 'worker.mjs',
        compatibility_date: COMPAT_DATE,
    };
    const form = new FormData();
    form.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    );
    form.append(
        'worker.mjs',
        new Blob([scriptSource], { type: 'application/javascript+module' }),
        'worker.mjs',
    );

    const res = await fetch(
        relayUrl(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`, proxyBase),
        {
            method: 'PUT',
            headers: authHeaders(token),
            body: form,
        },
    );
    await parseEnvelope<unknown>(res);
}

/**
 * Enables (or disables) the auto-assigned *.workers.dev route for a script.
 * Without this the script is uploaded but not reachable.
 */
export async function enableWorkersDevRoute(
    token: string,
    accountId: string,
    scriptName: string,
    proxyBase?: string,
): Promise<void> {
    const res = await fetch(
        relayUrl(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`, proxyBase),
        {
            method: 'POST',
            headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true }),
        },
    );
    await parseEnvelope<unknown>(res);
}

/**
 * Returns the account's workers.dev subdomain (e.g. "yourname" → "*.yourname.workers.dev").
 * If the user has never created one, the API returns an empty string and the
 * wizard surfaces a friendlier error.
 */
export async function getWorkersSubdomain(
    token: string,
    accountId: string,
    proxyBase?: string,
): Promise<string> {
    const res = await fetch(
        relayUrl(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/workers/subdomain`, proxyBase),
        { headers: { ...authHeaders(token), Accept: 'application/json' } },
    );
    const result = await parseEnvelope<{ subdomain?: string }>(res);
    return result.subdomain ?? '';
}

export function buildWorkerWssUrl(scriptName: string, subdomain: string): string {
    return `wss://${scriptName}.${subdomain}.workers.dev`;
}
