// Resolves the "native" pixel size Qt would use for a label's background
// image, so LabelOverlay can render it unscaled like Mudlet's
// `QLabel::setPixmap()` (see setBackgroundImage in ScriptingAPI) instead of
// letting the browser stretch it to fill the label.
//
// Raster formats (PNG/JPEG/GIF/...) already have real intrinsic dimensions
// that CSS `background-size: auto` renders natively — no fix needed there.
// SVGs without a `width`/`height` attribute have *no* CSS intrinsic size, so
// a bare `background-image` gets scaled to cover the label, which Qt never
// does: `QSvgRenderer::defaultSize()` falls back to the `viewBox` extent and
// `QPixmap` loads at exactly that pixel size, clipped by the label like any
// oversized pixmap. This only resolves that SVG case; other formats resolve
// to null and the caller leaves `background-size` alone.
export async function resolveSvgIntrinsicSize(url: string): Promise<{ width: number; height: number } | null> {
    if (!isSvgUrl(url)) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return parseSvgIntrinsicSize(await res.text());
    } catch {
        return null;
    }
}

function isSvgUrl(url: string): boolean {
    if (url.startsWith('data:')) return /^data:image\/svg\+xml/i.test(url);
    // Strip query/hash before checking the extension (e.g. `?v=2`).
    return /\.svg(?:[?#]|$)/i.test(url);
}

/** Exported for tests. Mirrors Qt's defaultSize(): explicit width+height
 *  wins, else the viewBox extent, else no intrinsic size (null). */
export function parseSvgIntrinsicSize(svgText: string): { width: number; height: number } | null {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;

    const w = parseSvgLength(svg.getAttribute('width'));
    const h = parseSvgLength(svg.getAttribute('height'));
    if (w !== null && h !== null) return { width: w, height: h };

    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] };
        }
    }
    return null;
}

function parseSvgLength(v: string | null): number | null {
    if (!v || v.endsWith('%')) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}
