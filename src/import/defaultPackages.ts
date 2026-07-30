import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import { useAppStore } from '../storage/appStore';
import { getBrand } from '../branding';
import { installPackageFromBytes } from './packageInstaller';
// In the library build this import is external (vite.lib.config.ts) and the
// file ships in dist-lib, so the consumer's Vite emits it as a real asset —
// otherwise lib mode would inline it as a ~150 kB base64 data URI.
import runLuaCodeUrl from './defaults/run-lua-code.mpackage?url';
// Vendored mirror of Mudlet's `src/mudlet-lua/lua/generic-mapper/`. Externalized
// in the library build too, and copied by scripts/copy-lib-assets.mjs.
import genericMapperUrl from '../scripting/lua/mudlet-lua/generic-mapper/generic_mapper.mpackage?url';
// Vendored copy of Mudlet's `src/mudlet-mapper.xml` (a Qt resource at its src
// root, so there's no directory layout to mirror — it lives with the other
// default-package assets). Plain XML, not a zip: the installer parses it into
// tree nodes and writes nothing to the VFS.
import mudletMapperUrl from './defaults/mudlet-mapper.xml?url';

interface DefaultPackage {
    /** Must match the manifest name produced by installPackageFromBytes. */
    name: string;
    /** Filename passed to the installer (drives manifest.name + on-disk dir). */
    filename: string;
    /** Vite-resolved URL to the bundled asset. */
    url: string;
    /** When set, an installed copy with a different manifest version is
     *  reinstalled fresh — how brands ship package updates to players. */
    version?: string;
}

const RUN_LUA_CODE: DefaultPackage = {
    name: 'run-lua-code', filename: 'run-lua-code.mpackage', url: runLuaCodeUrl,
};
/** Mudlet's IRE/`mmp` mapper. Drives the map from `gmcp.Room.Info` with no setup. */
const MUDLET_MAPPER: DefaultPackage = {
    name: 'mudlet-mapper', filename: 'mudlet-mapper.xml', url: mudletMapperUrl,
};
/** Mudlet's fallback mapper: works anywhere, but needs `map basics` configuring.
 *  `version` is declared so bumping the vendored archive reinstalls it into
 *  profiles that already have the old one — safe because the mapper keeps its
 *  state in `<profile>/map downloads/`, outside the package dir a reinstall wipes. */
const GENERIC_MAPPER: DefaultPackage = {
    name: 'generic_mapper', filename: 'generic_mapper.mpackage', url: genericMapperUrl, version: '2.1.8',
};

/**
 * Games that get the IRE mapper instead of the generic one — verbatim from the
 * `mudlet-mapper.xml` row of `defaultScripts` in mudlet.cpp.
 */
export const IRE_MAPPER_GAMES = [
    'aetolia.com', 'achaea.com', 'lusternia.com',
    'imperian.com', 'starmourn.com', 'stickmud.com',
];

/** Every bundled default, whatever the host — for tests and tooling. */
export const ALL_DEFAULTS: DefaultPackage[] = [RUN_LUA_CODE, MUDLET_MAPPER, GENERIC_MAPPER];

/**
 * The stock defaults for a profile on `host`.
 *
 * Mudlet ships these as Qt resources in `src/mudlet.qrc` and installs them on
 * profile open. We mirror that (and `setupPreInstallPackages`'s per-game
 * choices): each file is bundled as a static asset and installed once per
 * profile via the normal package pipeline, so it appears in the package list and
 * the user can uninstall it if they want.
 *
 * Exactly one mapper, always. `centerview()` is the only thing that moves the
 * map view and only a mapper calls it, so a profile with no mapper never follows
 * the player — and two mappers would both fire on the same movement.
 */
export function stockDefaults(host?: string): DefaultPackage[] {
    const isIreMapperGame = !!host && IRE_MAPPER_GAMES.some(g => g.toLowerCase() === host);
    return [RUN_LUA_CODE, isIreMapperGame ? MUDLET_MAPPER : GENERIC_MAPPER];
}

/** A default or brand package as the install loop sees it. */
export type InstallablePackage = DefaultPackage & { removable?: boolean };

/**
 * The packages to preinstall into a profile.
 *
 * A brand's list is exact and replaces the stock defaults rather than adding to
 * them — `[]` preinstalls nothing, and a brand shipping its own mapper simply
 * doesn't list ours. Unset means no opinion: the stock defaults for this game.
 */
export function resolveDefaultPackages(brandPackages: InstallablePackage[] | undefined, host?: string): InstallablePackage[] {
    return brandPackages ?? stockDefaults(host);
}

/** Hostname `stockDefaults` matches its game lists against, lowercased. */
export function connectionHost(conn: { mode?: string; host?: string; url?: string } | undefined): string | undefined {
    if (!conn) return undefined;
    // 'mud' mode stores host/port directly; 'websocket' mode only has a URL, so
    // pull the hostname out of it (a malformed URL simply doesn't match).
    if (conn.host) return conn.host.trim().toLowerCase() || undefined;
    if (!conn.url) return undefined;
    try {
        return new URL(conn.url).hostname.toLowerCase() || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Install any default packages the profile doesn't already have. Idempotent:
 * a package is skipped if its manifest name is already in `connectionPackages`
 * — so existing profiles also pick up newly-added defaults on next open.
 *
 * Which packages those are: `brand.packages` when a brand declares one (an
 * exact list — `[]` installs nothing), otherwise `stockDefaults(host)`.
 *
 * Profiles imported or linked from Mudlet are exempt entirely — their own
 * package set is authoritative, so nothing is added (returns `[]`).
 *
 * A default the user explicitly uninstalled stays uninstalled: the store's
 * `uninstallPackage` tombstones the name in the profile's
 * `uninstalledPackages` (Mudlet's `deletedDefaultMuds` equivalent), and this
 * skips tombstoned names — except brand packages marked `removable: false`,
 * which always come back.
 *
 * Failures are logged and swallowed: a broken default must never block the
 * profile from opening.
 *
 * Returns the manifest names that were actually (re)installed this call — a
 * fresh install into a profile that never had the package, or a version-bump
 * reinstall. The caller raises sysInstallPackage for each of these once the
 * runtime has loaded far enough for the package's own handlers to be
 * registered; a package whose scripts gate one-time setup on that event
 * (rather than the every-open sysLoadEvent) needs it fired here, since these
 * installs never go through the normal installPackageFromVfsPath path.
 */
export async function ensureDefaultPackages(connectionId: string, vfs: ProfileVFS): Promise<string[]> {
    const state = useAppStore.getState();
    const conn = state.connections.find(c => c.id === connectionId);
    // A profile imported or linked from Mudlet brings its own package set, which
    // is authoritative: Mudlet only preinstalls the stock defaults into brand-new
    // profiles (setupPreInstallPackages), so their absence here is a deliberate
    // state to preserve, not a gap to backfill. Adding a mapper or run-lua-code
    // the source profile never had would diverge from Mudlet and, for a second
    // mapper, fight the profile's own over centerview(). Install nothing.
    if (conn?.mudletImported || conn?.mudletLinked) return [];
    const installedPackages = state.connectionPackages[connectionId] ?? [];
    const removedByUser = new Set(state.connectionProfile[connectionId]?.uninstalledPackages ?? []);
    // BrandPackage is shape-compatible with DefaultPackage, plus `removable`.
    const host = connectionHost(conn);
    const defaults = resolveDefaultPackages(getBrand().packages, host);
    const installed: string[] = [];
    for (const def of defaults) {
        const current = installedPackages.find(p => p.name === def.name);
        // Installed and current (no declared version, or versions match) —
        // leave it alone. A version mismatch falls through to a clean
        // reinstall: how brands ship package updates to players.
        if (current && (!def.version || current.version === def.version)) continue;
        if (!current && def.removable !== false && removedByUser.has(def.name)) continue;
        try {
            const res = await fetch(def.url);
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${def.url}`);
            const buf = new Uint8Array(await res.arrayBuffer());
            const { manifest, data } = installPackageFromBytes(def.filename, buf, vfs);
            useAppStore.getState().installPackage(connectionId, manifest, data);
            installed.push(manifest.name);
        } catch (err) {
            console.warn(`[default-packages] failed to install ${def.name}:`, err);
        }
    }
    if (installed.length) await vfs.flush();
    return installed;
}
