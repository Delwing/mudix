import { useAppStore } from '../storage/appStore';
import { PROFILE_DATA_PATH, type PersistedProfileData } from '../storage/profileVfsData';
import { parseMudletProfile } from './mudletHost';
import { buildPackageManifests } from './mudletProfileImport';

// Link mode (read-only, phase 1): a profile whose VFS is a *linked Mudlet folder*
// loads its settings/automation/variables/packages from the newest current/*.xml
// on every open — so edits made in Mudlet show up in mudix. The .mudix/profile.json
// sidecar holds only mudix-only state (layout/dock/mapper/…), applied over the
// XML. Automation write-back to current/*.xml is phase 2; until then mudix's own
// automation edits aren't persisted to a linked profile.
//
// We read through the already-mounted ProfileVFS, so only this minimal surface
// is needed (and it keeps the loader unit-testable without a real VFS).
export interface VfsReader {
    exists(path: string): boolean;
    readdir(path: string): string[];
    stat(path: string): { mtime: Date } | null;
    readFile(path: string): string;
}

/** Path (relative to the profile root) of the newest profile save in current/,
 *  or null if the folder isn't a Mudlet profile. Newest is by mtime; if mtimes
 *  are unavailable (all zero) it prefers autosave.xml then the latest filename. */
export function findNewestCurrentXml(vfs: VfsReader): string | null {
    if (!vfs.exists('current')) return null;
    let names: string[];
    try {
        names = vfs.readdir('current').filter(n => n.toLowerCase().endsWith('.xml'));
    } catch {
        return null;
    }
    if (!names.length) return null;

    let best: string | null = null;
    let bestMtime = -1;
    for (const n of names) {
        const m = vfs.stat(`current/${n}`)?.mtime?.getTime() ?? 0;
        if (m > bestMtime) { bestMtime = m; best = n; }
    }
    if (bestMtime <= 0) {
        best = names.find(n => n.toLowerCase() === 'autosave.xml')
            ?? [...names].sort().pop()
            ?? null;
    }
    return best ? `current/${best}` : null;
}

/** Whether a mounted VFS looks like a linked Mudlet profile (has current/*.xml). */
export function isMudletProfileVfs(vfs: VfsReader): boolean {
    return findNewestCurrentXml(vfs) !== null;
}

function readSidecar(vfs: VfsReader): Partial<PersistedProfileData> {
    if (!vfs.exists(PROFILE_DATA_PATH)) return {};
    try {
        return JSON.parse(vfs.readFile(PROFILE_DATA_PATH)) as Partial<PersistedProfileData>;
    } catch {
        return {};
    }
}

/**
 * Hydrate the store for a Mudlet-linked profile from the newest current/*.xml,
 * layering the .mudix sidecar's mudix-only slices on top. Returns false if the
 * VFS isn't a Mudlet profile (caller falls back to the normal profile.json load).
 * `installedAt` stamps the package manifests (pass an ISO timestamp).
 */
export function loadMudletLinkedProfile(vfs: VfsReader, connectionId: string, installedAt: string): boolean {
    const xmlPath = findNewestCurrentXml(vfs);
    if (!xmlPath) return false;

    const data = parseMudletProfile(vfs.readFile(xmlPath));
    const packages = buildPackageManifests(data.installedPackages, name => {
        const p = `${name}/config.lua`;
        try { return vfs.exists(p) ? vfs.readFile(p) : undefined; } catch { return undefined; }
    }).map(m => ({ ...m, installedAt }));

    const sidecar = readSidecar(vfs);
    const vars = data.variables.variables;

    useAppStore.getState().hydrateConnectionData(connectionId, {
        // Automation + settings + variables are authoritative from the XML.
        scripts: data.automation.scripts,
        aliases: data.automation.aliases,
        triggers: data.automation.triggers,
        timers: data.automation.timers,
        keybindings: data.automation.keys,
        buttons: data.automation.buttons,
        packages,
        variables: { saveList: vars.map(v => v.name), values: vars },
        // XML settings as the base; mudix-only profile fields (mapper, font source,
        // mapViewStates, …) from the sidecar win where set.
        profile: { ...data.settings, ...(sidecar.profile ?? {}) },
        // Pure mudix-only UI/layout slices come entirely from the sidecar.
        windowHints: sidecar.windowHints,
        dockExtents: sidecar.dockExtents,
        scriptEditorBounds: sidecar.scriptEditorBounds,
        modalBounds: sidecar.modalBounds,
        layoutSnapshot: sidecar.layoutSnapshot,
    });
    return true;
}
