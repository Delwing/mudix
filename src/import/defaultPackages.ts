import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import { useAppStore } from '../storage/appStore';
import { installPackageFromBytes } from './packageInstaller';
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
 * — so existing profiles also pick up newly-added defaults on next open, and
 * a user who deleted a default keeps it deleted (next call sees it missing in
 * the store and would reinstall — see Note).
 *
 * Failures are logged and swallowed: a broken default must never block the
 * profile from opening.
 *
 * Note on user deletes: today this reinstalls a default the user explicitly
 * removed. If that becomes a problem, track removed-default names in a
 * persisted set (mirroring Mudlet's `deletedDefaultMuds` settings key).
 */
export async function ensureDefaultPackages(connectionId: string, vfs: ProfileVFS): Promise<void> {
    const installed = new Set(
        (useAppStore.getState().connectionPackages[connectionId] ?? []).map(p => p.name),
    );
    let installedAny = false;
    for (const def of DEFAULTS) {
        if (installed.has(def.name)) continue;
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
