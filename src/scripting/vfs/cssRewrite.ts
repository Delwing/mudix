import type { ProfileVFS } from './ProfileVFS';
import { vfsUrlFor } from './vfsBridge';

// Match url(<ref>) where <ref> is unquoted, single-quoted, or double-quoted.
// The CSS spec allows whitespace around the ref but no balanced parens inside,
// which is fine for the asset URLs scripts emit.
const URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g;

const PASSTHROUGH_PREFIX = /^(?:https?:|data:|blob:|\/__vfs\/)/i;

/**
 * Rewrite `url(<local-path>)` references in a Qt/CSS stylesheet to
 * `url(/__vfs/<connectionId>/<path>)` so the registered service worker can
 * serve the bytes from the connection's ProfileVFS. Already-absolute http/data/
 * blob/__vfs URLs pass through untouched.
 *
 * Paths are resolved through the VFS (which honours its cwd and profile root)
 * and rebased onto the profile root before being put into the URL.
 */
export function rewriteVfsUrlsInCss(css: string, connectionId: string, vfs: ProfileVFS): string {
    return css.replace(URL_RE, (full, dq: string | undefined, sq: string | undefined, raw: string | undefined) => {
        const ref = (dq ?? sq ?? raw ?? '').trim();
        if (!ref) return full;
        if (PASSTHROUGH_PREFIX.test(ref)) return full;
        const resolved = vfs.resolvePath(ref);
        const profilePrefix = `${vfs.profilePath}/`;
        const within = resolved.startsWith(profilePrefix)
            ? resolved.slice(profilePrefix.length)
            : resolved.replace(/^\//, '');
        return `url("${vfsUrlFor(connectionId, within)}")`;
    });
}
