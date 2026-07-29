import { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import { PROFILE_DATA_PATH, type PersistedProfileData } from '../storage/profileVfsData';
import { loadMap } from '../storage/mapStorage';
import { listSessions, getSessionEntries } from '../storage/logStorage';
import { buildSessionHtml, formatSessionFileStamp } from '../storage/logExport';
import type { MudConnection } from '../storage/schema';
import type { ExportLog, ProfileExportSource } from './mudletProfileExport';

// Gathers everything one profile owns across the three stores it's spread over
// (its VFS, the map IndexedDB, the log IndexedDB) into the plain data that
// mudletProfileExport turns into a Mudlet profile folder. Split from the pure
// builders so those stay testable without ZenFS/IndexedDB.

/** Files under this directory are mudix bookkeeping, not user content: the
 *  profile JSON is re-serialized into the profile XML, and the connection
 *  sidecar is written fresh on export. */
const VFS_INTERNAL_DIR = '.mudix';

/** Depth cap for the VFS walk. Profile trees are shallow (packages/<pkg>/…);
 *  the cap is a cheap guard against a pathological or cyclic tree hanging the
 *  export rather than a real structural limit. */
const MAX_WALK_DEPTH = 12;

function walk(vfs: ProfileVFS, dir: string, depth: number, out: Record<string, Uint8Array>): void {
    if (depth > MAX_WALK_DEPTH) return;
    let names: string[];
    try {
        names = vfs.readdir(dir || '/');
    } catch {
        return; // unreadable directory: skip rather than fail the whole export
    }
    for (const name of names) {
        const rel = dir ? `${dir}/${name}` : name;
        if (rel === VFS_INTERNAL_DIR || rel.startsWith(`${VFS_INTERNAL_DIR}/`)) continue;
        const st = vfs.stat(rel);
        if (!st) continue;
        if (st.type === 'dir') {
            walk(vfs, rel, depth + 1, out);
        } else {
            try {
                out[rel] = vfs.readBinaryFile(rel);
            } catch (err) {
                console.warn('[collectProfileExport] unreadable file skipped:', rel, err);
            }
        }
    }
}

function readProfileData(vfs: ProfileVFS): PersistedProfileData {
    const empty: PersistedProfileData = {
        version: 0, scripts: [], aliases: [], triggers: [], timers: [],
        keybindings: [], buttons: [], packages: [],
    };
    if (!vfs.exists(PROFILE_DATA_PATH)) return empty;
    try {
        return { ...empty, ...(JSON.parse(vfs.readFile(PROFILE_DATA_PATH)) as PersistedProfileData) };
    } catch (err) {
        console.warn('[collectProfileExport] profile.json unparseable, exporting files only', err);
        return empty;
    }
}

async function collectLogs(connectionId: string): Promise<ExportLog[]> {
    const sessions = await listSessions(connectionId);
    const logs: ExportLog[] = [];
    for (const session of sessions) {
        const entries = await getSessionEntries(session.id);
        if (!entries.length) continue;
        logs.push({
            name: `${session.connectionName} ${formatSessionFileStamp(session.startedAt)}`,
            html: buildSessionHtml(session, entries),
        });
    }
    return logs;
}

export interface CollectOptions {
    /** Session logs aren't part of the Mudlet format; they ride along under
     *  `logs/` so a migrating user doesn't leave history behind. */
    includeLogs?: boolean;
}

/**
 * Read one profile out of storage, ready for export.
 *
 * The profile's `.mudix/profile.json` is the source of truth — not the Zustand
 * store, which only holds slices for the *open* profile. A profile open in
 * another tab may therefore be up to one save-debounce stale; exporting from the
 * connection screen (where nothing is open) always sees the committed state.
 */
export async function collectProfileExport(
    connection: MudConnection,
    opts: CollectOptions = {},
): Promise<ProfileExportSource> {
    const vfs = await ProfileVFS.mount(connection.id);
    let data: PersistedProfileData;
    const files: Record<string, Uint8Array> = {};
    try {
        data = readProfileData(vfs);
        walk(vfs, '', 0, files);
    } finally {
        vfs.unmount();
    }

    let mapBytes: Uint8Array | undefined;
    try {
        const buf = await loadMap(connection.id);
        if (buf) mapBytes = new Uint8Array(buf);
    } catch (err) {
        console.warn('[collectProfileExport] map read failed', err);
    }

    let logs: ExportLog[] | undefined;
    if (opts.includeLogs) {
        try {
            logs = await collectLogs(connection.id);
        } catch (err) {
            console.warn('[collectProfileExport] log read failed', err);
        }
    }

    return { connection, data, files, mapBytes, logs };
}
