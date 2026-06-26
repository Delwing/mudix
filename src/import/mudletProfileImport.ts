import { unzipSync, strFromU8 } from 'fflate';
import type { PackageManifest } from '../storage/schema';
import { parseMudletProfile, type MudletProfileImport, type MudletModuleRef } from './mudletHost';
import { parseMudletXml } from './mudletXmlImport';

// Turn the raw files of a Mudlet profile — a directory the user picked, or a
// .zip of one — into a structured bundle ready to provision a new mudix profile.
// Source-agnostic: callers hand in a {path -> bytes} map (from a File System
// Access directory walk or an unzip), and this locates the newest saved profile
// XML, the newest binary map, the remaining profile-root files, and the package
// manifests to register.

export interface MudletProfileBundle {
    /** Profile name — `<Host><name>`, else the profile folder name, else fallback. */
    name: string;
    /** MUD address from `<Host>` (`<url>`/`<port>`), if present. */
    host?: string;
    port?: number;
    /** Parsed settings + automation + variables from the newest current/*.xml. */
    profile: MudletProfileImport;
    /** Manifests for the profile's installed packages (from <mInstalledPackages>,
     *  metadata from each package's config.lua). Registered on import so
     *  getPackageInfo / package managers see them as installed. */
    packages: PackageManifest[];
    /** Modules the profile loads from external local XML files — unresolvable in a
     *  browser; the import UI asks the user to upload or drop each. */
    modules: MudletModuleRef[];
    /** Newest map/* binary, ready for mapStorage. Undefined if the profile has no map. */
    mapBytes?: Uint8Array;
    /** Remaining profile-root files to copy into the new VFS (packages, fonts,
     *  sounds, …), keyed relative to the profile root. Excludes current/ and map/. */
    files: Record<string, Uint8Array>;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** The profile-root prefix (with trailing slash, or '') for a path that sits at
 *  or under a `current/` directory — i.e. everything before `current/`. */
function rootOfCurrent(lowerPath: string): string | null {
    if (lowerPath.startsWith('current/')) return '';
    const i = lowerPath.indexOf('/current/');
    return i >= 0 ? lowerPath.slice(0, i + 1) : null;
}

function basename(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

/** Pick the newest of `paths` by mtime when available; else null (caller decides
 *  a deterministic fallback). */
function newestByMtime(paths: string[], mtimes: Record<string, number> | undefined): string | null {
    if (!paths.length || !mtimes) return null;
    return paths.reduce((a, b) => ((mtimes[b] ?? 0) > (mtimes[a] ?? 0) ? b : a));
}

// Pull a few standard fields out of a package's config.lua. Not a Lua eval —
// just matches `key = "..."` / `key = [[...]]` / `key = '...'` assignments, which
// is how Mudlet/muddler config.lua files declare their metadata.
function parseConfigLua(src: string): Partial<PackageManifest> {
    const field = (key: string): string | undefined => {
        const m = src.match(new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*(?:\\[\\[([\\s\\S]*?)\\]\\]|"([^"]*)"|'([^']*)')`));
        const v = (m?.[1] ?? m?.[2] ?? m?.[3])?.trim();
        return v ? v : undefined;
    };
    const out: Partial<PackageManifest> = {};
    const version = field('version'); if (version) out.version = version;
    const author = field('author'); if (author) out.author = author;
    const title = field('title'); if (title) out.title = title;
    const description = field('description'); if (description) out.description = description;
    const icon = field('icon'); if (icon) out.icon = icon;
    const created = field('created'); if (created) out.created = created;
    return out;
}

/** Build a manifest per installed package, reading metadata from `<name>/config.lua`
 *  in the profile files when present. `installedAt` is left empty for the importer
 *  to stamp (keeps this pure/deterministic). */
function buildManifests(names: string[], files: Record<string, Uint8Array>): PackageManifest[] {
    const byLower = new Map(Object.keys(files).map(k => [k.toLowerCase(), k]));
    return names.map(name => {
        const cfgKey = byLower.get(`${name.toLowerCase()}/config.lua`);
        let info: Partial<PackageManifest> = {};
        if (cfgKey) {
            try { info = parseConfigLua(strFromU8(files[cfgKey])); } catch { /* leave bare */ }
        }
        return { name, installedAt: '', kind: 'package' as const, ...info };
    });
}

/**
 * Build a profile bundle from a Mudlet profile's files. `fallbackName` is used
 * when neither the Host `<name>` nor a wrapping folder name is available.
 * `mtimes` (keyed the same as `files`) makes the newest-save selection match
 * Mudlet's (most-recently-modified wins); without it, a deterministic fallback
 * prefers `current/autosave.xml` then the latest timestamp filename.
 * Throws if no `current/*.xml` is present (not a Mudlet profile).
 */
export function buildMudletProfileBundle(
    files: Record<string, Uint8Array>,
    fallbackName = 'Imported profile',
    mtimes?: Record<string, number>,
): MudletProfileBundle {
    // Normalize separators and index by lower-case path for matching.
    const norm = new Map<string, Uint8Array>();
    const normMtime: Record<string, number> = {};
    for (const [k, v] of Object.entries(files)) {
        const p = normalizePath(k);
        if (!p || p.endsWith('/')) continue;
        norm.set(p, v);
        if (mtimes && mtimes[k] !== undefined) normMtime[p] = mtimes[k];
    }

    // Find the profile root via any current/*.xml; prefer the shallowest root so
    // a zip that wraps the profile dir (or nests other junk) resolves correctly.
    let root: string | null = null;
    for (const p of norm.keys()) {
        const lower = p.toLowerCase();
        if (!/(^|\/)current\/[^/]+\.xml$/.test(lower)) continue;
        const r = rootOfCurrent(lower);
        if (r !== null && (root === null || r.length < root.length)) root = r;
    }
    if (root === null) throw new Error('Not a Mudlet profile: no current/*.xml found');
    const rootPrefix = root;

    // Re-key everything relative to the profile root, carrying mtimes along.
    const rel = new Map<string, Uint8Array>();
    const relMtime: Record<string, number> = {};
    for (const [p, v] of norm) {
        if (rootPrefix && !p.toLowerCase().startsWith(rootPrefix)) continue;
        const r = p.slice(rootPrefix.length);
        rel.set(r, v);
        if (normMtime[p] !== undefined) relMtime[r] = normMtime[p];
    }
    const haveMtimes = mtimes && Object.keys(relMtime).length > 0 ? relMtime : undefined;

    const currentXmls: string[] = [];
    const maps: string[] = [];
    const others: Record<string, Uint8Array> = {};
    for (const relPath of rel.keys()) {
        const lower = relPath.toLowerCase();
        if (/^current\/[^/]+\.xml$/.test(lower)) currentXmls.push(relPath);
        else if (lower.startsWith('current/')) { /* non-xml current files: ignore */ }
        else if (lower.startsWith('map/')) maps.push(relPath);
        else others[relPath] = rel.get(relPath)!;
    }
    if (!currentXmls.length) throw new Error('Not a Mudlet profile: no current/*.xml found');

    // Newest save: mtime when we have it, else prefer autosave.xml, else the
    // latest timestamp filename (Mudlet names saves YYYY-MM-DD#HH-mm-ss.xml).
    let newestXml = newestByMtime(currentXmls, haveMtimes);
    if (!newestXml) {
        newestXml = currentXmls.find(p => basename(p).toLowerCase() === 'autosave.xml')
            ?? currentXmls.reduce((a, b) => (basename(b) > basename(a) ? b : a));
    }
    let newestMap = newestByMtime(maps, haveMtimes);
    if (!newestMap && maps.length) {
        newestMap = maps.reduce((a, b) => (basename(b) > basename(a) ? b : a));
    }

    const profile = parseMudletProfile(strFromU8(rel.get(newestXml)!));
    const folderName = rootPrefix ? basename(rootPrefix.replace(/\/$/, '')) : '';
    return {
        name: profile.connection.name || folderName || fallbackName,
        host: profile.connection.host,
        port: profile.connection.port,
        profile,
        packages: buildManifests(profile.installedPackages, others),
        modules: profile.modules,
        mapBytes: newestMap ? rel.get(newestMap) : undefined,
        files: others,
    };
}

/** Build a profile bundle from a `.zip` of a Mudlet profile directory. (Zip
 *  entry mtimes aren't surfaced, so newest-save uses the autosave/timestamp
 *  fallback.) */
export function extractMudletProfileZip(
    bytes: Uint8Array,
    fallbackName = 'Imported profile',
): MudletProfileBundle {
    return buildMudletProfileBundle(unzipSync(bytes), fallbackName);
}

// ── modules ──────────────────────────────────────────────────────────────────
// A Mudlet module loads its content from an external XML file on the user's disk
// (e.g. C:/Users/.../buttons.xml). A browser can't read that path, but the file
// is sometimes present inside the imported profile tree — so we match by
// basename. Whatever's resolved is baked into the profile as a normal (removable)
// package; a browser can't live-sync to an external file anyway. Anything not
// found is surfaced for the user to upload or drop.

export interface ResolvedModule {
    ref: MudletModuleRef;
    xmlBytes: Uint8Array;
}

function fileBasename(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
}

/** Split a bundle's modules into those whose XML was found in the imported tree
 *  (by filename) and those still missing. */
export function resolveModulesFromTree(bundle: MudletProfileBundle): {
    resolved: ResolvedModule[];
    unresolved: MudletModuleRef[];
} {
    const byBase = new Map<string, Uint8Array>();
    for (const [p, b] of Object.entries(bundle.files)) byBase.set(fileBasename(p), b);
    const resolved: ResolvedModule[] = [];
    const unresolved: MudletModuleRef[] = [];
    for (const ref of bundle.modules) {
        const bytes = byBase.get(fileBasename(ref.filepath));
        if (bytes) resolved.push({ ref, xmlBytes: bytes });
        else unresolved.push(ref);
    }
    return { resolved, unresolved };
}

/**
 * Fold a resolved/uploaded module's XML into the bundle: its triggers/aliases/…
 * are parsed (grouped + tagged under the module key, so it's a removable unit)
 * and appended to the automation, and a manifest is registered. Mutates and
 * returns the bundle. Treated as a package — the live-sync-to-disk behaviour
 * doesn't apply in a browser.
 */
export function addModuleToBundle(bundle: MudletProfileBundle, key: string, xmlBytes: Uint8Array): MudletProfileBundle {
    const parsed = parseMudletXml(strFromU8(xmlBytes), { packageName: key });
    const a = bundle.profile.automation;
    a.scripts.push(...parsed.scripts);
    a.aliases.push(...parsed.aliases);
    a.triggers.push(...parsed.triggers);
    a.timers.push(...parsed.timers);
    a.keys.push(...parsed.keys);
    a.buttons.push(...parsed.buttons);
    a.warnings.push(...parsed.warnings);
    if (!bundle.packages.some(p => p.name === key)) {
        bundle.packages.push({ name: key, installedAt: '', kind: 'package' });
    }
    return bundle;
}
