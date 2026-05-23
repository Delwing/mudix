/**
 * Browse and install packages from Mudlet's official package repository.
 *
 * The repository is published as a static site backed by the
 * github.com/Mudlet/mudlet-package-repository git repo. A reindex script
 * regenerates `packages/mpkg.packages.json` after every commit, so the JSON
 * catalog is authoritative — we don't try to scrape the all-packages.html page.
 *
 * Catalog shape (top-level object):
 *   { name, updated, packages: PackageRepoEntry[] }
 *
 * URLs are constructed from the repo's GitHub Pages base. Icon paths inside
 * each entry are already relative to the repo root (e.g. "packages/icons/Foo.png"),
 * so they're joined to REPO_BASE_URL verbatim.
 */

/**
 * Public-facing repository site (used for "view in browser" links).
 * NOT used for fetching the catalog — the GitHub Pages mirror lags weeks behind
 * the main branch. Mudlet's own package manager dialog hits raw.githubusercontent.com
 * for the same reason; we mirror that choice.
 */
export const REPO_SITE_URL = 'https://mudlet.github.io/mudlet-package-repository';

/** Base for fetching individual .mpackage files and icons (always-current `main` branch). */
export const REPO_RAW_BASE = 'https://raw.githubusercontent.com/Mudlet/mudlet-package-repository/refs/heads/main';
export const CATALOG_URL = `${REPO_RAW_BASE}/packages/mpkg.packages.json`;

export interface PackageRepoEntry {
    /** Internal identifier (matches manifest.name produced by installPackageFromBytes). */
    mpackage: string;
    /** Filename inside the repo's packages/ directory, e.g. "Foo.mpackage". */
    filename: string;
    title?: string;
    description?: string;
    author?: string;
    version?: string;
    /** ISO-8601 author-declared creation date. */
    created?: string;
    /** Unix timestamp the package was last uploaded to the repo. */
    uploaded?: number;
    /** Repo-relative icon path, e.g. "packages/icons/Foo.png". Optional. */
    icon?: string;
}

export interface PackageRepoCatalog {
    name: string;
    updated: string;
    packages: PackageRepoEntry[];
}

/** Absolute URL of the .mpackage zip for `entry`. */
export function packageDownloadUrl(entry: PackageRepoEntry): string {
    return `${REPO_RAW_BASE}/packages/${encodeURIComponent(entry.filename)}`;
}

/** Absolute URL of the icon image for `entry`, or null when none. */
export function packageIconUrl(entry: PackageRepoEntry): string | null {
    if (!entry.icon) return null;
    return `${REPO_RAW_BASE}/${entry.icon}`;
}

/**
 * Fetch a URL, falling back through the configured proxy when the direct
 * request fails. Mirrors HttpService.fetchWithFallback — duplicated rather
 * than imported because HttpService is tied to the scripting runtime's emit
 * pipeline, and the repository browser doesn't need that machinery.
 *
 * The proxy URL may use ws:// / wss:// (since users configure it for the
 * MUD-tunnel use case); we swap the scheme for HTTP forwards just like
 * HttpService does.
 */
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

/** Fetch and parse the package catalog. Throws on network or JSON errors. */
export async function fetchPackageCatalog(proxyUrl?: string): Promise<PackageRepoCatalog> {
    const res = await fetchWithProxyFallback(CATALOG_URL, proxyUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching package catalog`);
    const json = await res.json();
    if (!json || !Array.isArray(json.packages)) {
        throw new Error('Malformed package catalog (missing "packages" array)');
    }
    return json as PackageRepoCatalog;
}

/** Download a single package's bytes. The caller is expected to pass it to installPackageFromBytes. */
export async function downloadPackageBytes(entry: PackageRepoEntry, proxyUrl?: string): Promise<Uint8Array> {
    const url = packageDownloadUrl(entry);
    const res = await fetchWithProxyFallback(url, proxyUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${entry.filename}`);
    return new Uint8Array(await res.arrayBuffer());
}
