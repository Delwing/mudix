import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import type { OutputFontSource } from '../storage';

const PROBE_TEXT = 'mwijMWIJ0123!@#';
const PROBE_FALLBACKS = ['monospace', 'serif', 'sans-serif'] as const;

function quoteFamily(family: string): string {
    return `"${family.replace(/"/g, '\\"')}"`;
}

/**
 * Returns true when `family` measures differently than every fallback —
 * the canonical "is this font installed/loaded?" trick. `document.fonts.check`
 * is unreliable for unknown system fonts and can't distinguish a missing
 * family from one that's just not in the FontFaceSet yet.
 */
export function isFontAvailable(family: string): boolean {
    const trimmed = family.trim();
    if (!trimmed) return false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    return PROBE_FALLBACKS.every(fb => {
        ctx.font = `16px ${fb}`;
        const baseline = ctx.measureText(PROBE_TEXT).width;
        ctx.font = `16px ${quoteFamily(trimmed)}, ${fb}`;
        return ctx.measureText(PROBE_TEXT).width !== baseline;
    });
}

export interface LocalFontEntry {
    family: string;
    fullName: string;
    postscriptName: string;
    style?: string;
}

interface LocalFontApi {
    query: () => Promise<LocalFontEntry[]>;
}

function getLocalFontApi(): LocalFontApi | null {
    const api = (navigator as unknown as { fonts?: LocalFontApi }).fonts;
    return api && typeof api.query === 'function' ? api : null;
}

export function isLocalFontApiSupported(): boolean {
    return getLocalFontApi() !== null;
}

export async function queryLocalFonts(): Promise<LocalFontEntry[]> {
    const api = getLocalFontApi();
    if (!api) throw new Error('Local Font Access API not available in this browser.');
    return api.query();
}

const LINK_DATA_ATTR = 'mudixFontUrl';

function ensureStylesheet(url: string): HTMLLinkElement {
    const existing = document.querySelector<HTMLLinkElement>(
        `link[data-${LINK_DATA_ATTR.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${url}"]`,
    );
    if (existing) return existing;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset[LINK_DATA_ATTR] = url;
    document.head.appendChild(link);
    return link;
}

export async function loadFontFromUrl(family: string, url: string): Promise<void> {
    ensureStylesheet(url);
    try {
        await document.fonts.load(`16px ${quoteFamily(family)}`);
    } catch {
        // Stylesheet may still be loading; the canvas check will surface failures.
    }
}

const loadedVfsKeys = new Set<string>();

function vfsKey(family: string, vfs: ProfileVFS, path: string): string {
    return `${vfs.profilePath}::${path}::${family}`;
}

export async function loadFontFromVfs(family: string, path: string, vfs: ProfileVFS): Promise<void> {
    const key = vfsKey(family, vfs, path);
    if (loadedVfsKeys.has(key)) return;
    const raw = vfs.readBinaryFile(path);
    // Defensive copy: ZenFS may return a Buffer view with non-zero byteOffset.
    const bytes = new Uint8Array(raw.byteLength);
    bytes.set(raw);
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    loadedVfsKeys.add(key);
}

const OUTPUT_FONT_VAR = '--font-output';

export async function applyOutputFont(
    font: OutputFontSource | undefined,
    vfs: ProfileVFS | null,
): Promise<void> {
    if (!font || !font.family.trim()) {
        document.documentElement.style.removeProperty(OUTPUT_FONT_VAR);
        return;
    }
    try {
        if (font.kind === 'url') {
            await loadFontFromUrl(font.family, font.url);
        } else if (font.kind === 'vfs' && vfs) {
            await loadFontFromVfs(font.family, font.path, vfs);
        }
    } catch (e) {
        console.error('[fontLoader] failed to register font', font, e);
    }
    document.documentElement.style.setProperty(OUTPUT_FONT_VAR, quoteFamily(font.family));
}
