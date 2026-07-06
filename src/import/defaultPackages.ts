import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import { useAppStore } from '../storage/appStore';
import { getBrand } from '../branding';
import { installPackageFromBytes } from './packageInstaller';
// In the library build this import is external (vite.lib.config.ts) and the
// file ships in dist-lib, so the consumer's Vite emits it as a real asset —
// otherwise lib mode would inline it as a ~150 kB base64 data URI.
import runLuaCodeUrl from './defaults/run-lua-code.mpackage?url';

interface DefaultPackage {
    /** Must match the manifest name produced by installPackageFromBytes. */
    name: string;
    /** Filename passed to the installer (drives manifest.name + on-disk dir). */
    filename: string;
    /** Vite-resolved URL to the bundled asset. */
    url: string;
}

/**
 * Mudlet ships these as Qt resources in `src/mudlet.qrc` and installs them on
 * profile open. We mirror that: each file is bundled as a static asset and
 * installed once per profile via the normal package pipeline, so it appears in
 * the package list and the user can uninstall it if they want.
 */
const DEFAULTS: DefaultPackage[] = [
    { name: 'run-lua-code', filename: 'run-lua-code.mpackage', url: runLuaCodeUrl },
];

/**
 * Install any default packages the profile doesn't already have. Idempotent:
 * a package is skipped if its manifest name is already in `connectionPackages`
 * — so existing profiles also pick up newly-added defaults on next open.
 *
 * A default the user explicitly uninstalled stays uninstalled: the store's
 * `uninstallPackage` tombstones the name in the profile's
 * `uninstalledPackages` (Mudlet's `deletedDefaultMuds` equivalent), and this
 * skips tombstoned names — except brand packages marked `removable: false`,
 * which always come back.
 *
 * Failures are logged and swallowed: a broken default must never block the
 * profile from opening.
 */
export async function ensureDefaultPackages(connectionId: string, vfs: ProfileVFS): Promise<void> {
    const state = useAppStore.getState();
    const installed = new Set(
        (state.connectionPackages[connectionId] ?? []).map(p => p.name),
    );
    const removedByUser = new Set(state.connectionProfile[connectionId]?.uninstalledPackages ?? []);
    // Brand-bundled packages install through the same pipeline, after the
    // stock defaults (BrandPackage is shape-compatible with DefaultPackage);
    // a brand can drop the stock set entirely via `stockPackages: false`.
    const brand = getBrand();
    const defaults: (DefaultPackage & { removable?: boolean })[] = [
        ...(brand.stockPackages === false ? [] : DEFAULTS),
        ...(brand.packages ?? []),
    ];
    let installedAny = false;
    for (const def of defaults) {
        if (installed.has(def.name)) continue;
        if (def.removable !== false && removedByUser.has(def.name)) continue;
        try {
            const res = await fetch(def.url);
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${def.url}`);
            const buf = new Uint8Array(await res.arrayBuffer());
            const { manifest, data } = installPackageFromBytes(def.filename, buf, vfs);
            useAppStore.getState().installPackage(connectionId, manifest, data);
            installedAny = true;
        } catch (err) {
            console.warn(`[default-packages] failed to install ${def.name}:`, err);
        }
    }
    if (installedAny) await vfs.flush();
}
