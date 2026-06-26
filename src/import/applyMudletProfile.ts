import { useAppStore } from '../storage/appStore';
import { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import { saveProfileData } from '../storage/profileVfsData';
import { saveMap } from '../storage/mapStorage';
import { buildMudletProfileBundle, type MudletProfileBundle } from './mudletProfileImport';

// Apply a parsed Mudlet profile bundle (see mudletProfileImport.ts) as a NEW
// native mudix profile: create the connection, provision its VFS (copy map +
// loose files), and seed its store slices (settings, automation, variables).
// This is a one-time copy — mudix owns the result; the original Mudlet folder is
// never touched and there is no write-back. (Live "link" mode, where the Mudlet
// XML stays the source of truth, is a separate feature.)

/** The per-connection store slices a bundle maps to. Pure — no side effects, so
 *  it's unit-testable; `importMudletProfile` applies it. Automation is imported
 *  profile-owned (as authored in Mudlet), not package-tagged. */
export function bundleToConnectionData(bundle: MudletProfileBundle, installedAt: string) {
    const a = bundle.profile.automation;
    const vars = bundle.profile.variables.variables;
    return {
        scripts: a.scripts,
        aliases: a.aliases,
        triggers: a.triggers,
        timers: a.timers,
        keybindings: a.keys,
        buttons: a.buttons,
        // Register the profile's installed packages so package managers (mpkg)
        // and getPackageInfo see them as installed. Stamp the install time here
        // (the bundle leaves it empty to stay pure/deterministic).
        packages: bundle.packages.map(p => (p.installedAt ? p : { ...p, installedAt })),
        profile: bundle.profile.settings,
        // Every saved variable in the imported <VariablePackage> seeds the
        // save-list; its current value is restored into _G on first open.
        variables: { saveList: vars.map(v => v.name), values: vars },
    };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Create a new mudix profile from a Mudlet profile bundle. Returns the new
 * connection id. The profile opens offline like any other; its data is durable
 * in the new VFS (`.mudix/profile.json`) and map store before this resolves.
 */
export async function importMudletProfile(bundle: MudletProfileBundle): Promise<string> {
    const connectionId = useAppStore.getState().addConnection({
        name: bundle.name,
        mode: 'mud',
        host: bundle.host ?? '',
        port: bundle.port ?? 23,
    });

    const vfs = await ProfileVFS.mount(connectionId);
    try {
        // Copy the profile-root files (packages, fonts, sounds, …) verbatim.
        for (const [rel, bytes] of Object.entries(bundle.files)) {
            try {
                vfs.writeBinaryFile(rel, bytes);
            } catch (err) {
                console.warn('[importMudletProfile] failed to write', rel, err);
            }
        }
        // Seed the store, then flush it to the profile's .mudix/profile.json so
        // it's durable for when the user opens the profile (which re-hydrates
        // from that file). Hydrating a non-active connection doesn't disturb any
        // open session — its subscription keys on its own connection id.
        useAppStore.getState().hydrateConnectionData(connectionId, bundleToConnectionData(bundle, new Date().toISOString()));
        saveProfileData(vfs, connectionId);
        await vfs.flush();
    } finally {
        vfs.unmount();
    }

    if (bundle.mapBytes) {
        try {
            await saveMap(connectionId, toArrayBuffer(bundle.mapBytes));
        } catch (err) {
            console.warn('[importMudletProfile] map save failed', err);
        }
    }

    return connectionId;
}

/** Recursively read a picked directory into {path -> bytes} + {path -> mtime}
 *  maps for buildMudletProfileBundle. The directory's own name isn't included in
 *  the keys, so a picked profile folder yields `current/…`, `map/…` at the root.
 *  The mtimes let the bundle pick the most-recently-saved XML the way Mudlet does. */
export async function readDirectoryHandle(
    root: FileSystemDirectoryHandle,
): Promise<{ files: Record<string, Uint8Array>; mtimes: Record<string, number> }> {
    const files: Record<string, Uint8Array> = {};
    const mtimes: Record<string, number> = {};
    interface DirEntries { entries(): AsyncIterable<[string, FileSystemHandle]>; }
    async function recurse(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
        for await (const [name, handle] of (dir as unknown as DirEntries).entries()) {
            const rel = prefix ? `${prefix}/${name}` : name;
            if (handle.kind === 'directory') {
                await recurse(handle as FileSystemDirectoryHandle, rel);
            } else {
                const file = await (handle as FileSystemFileHandle).getFile();
                files[rel] = new Uint8Array(await file.arrayBuffer());
                mtimes[rel] = file.lastModified;
            }
        }
    }
    await recurse(root, '');
    return { files, mtimes };
}

/** Build a bundle from a picked directory handle (mtime-aware newest-save pick). */
export async function bundleFromDirectory(dir: FileSystemDirectoryHandle): Promise<MudletProfileBundle> {
    const { files, mtimes } = await readDirectoryHandle(dir);
    return buildMudletProfileBundle(files, dir.name || 'Imported profile', mtimes);
}

/** Import a Mudlet profile from a picked directory handle (no unresolved-module
 *  handling — callers that need the upload/remove flow should use bundleFromDirectory
 *  + resolveModulesFromTree first). */
export async function importMudletProfileFromDirectory(dir: FileSystemDirectoryHandle): Promise<string> {
    return importMudletProfile(await bundleFromDirectory(dir));
}
