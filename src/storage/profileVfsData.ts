import type {
    ScriptNode,
    AliasNode,
    TriggerNode,
    TimerNode,
    KeyNode,
    ButtonNode,
    PackageManifest,
} from './schema';
import { useAppStore } from './appStore';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';

/**
 * Per-profile automation data is stored inside that profile's own VFS rather
 * than the shared localStorage blob — see the design notes in CLAUDE.md /
 * the storage layer. One JSON file per profile holds the bulky tree data
 * (scripts, aliases, triggers, …); the small UI/layout slices stay in
 * localStorage because they're read synchronously before the VFS mounts.
 *
 * The file is dot-prefixed so it stays out of the way in the user-browsable
 * file area. `ProfileVFS.writeFile` creates the `.mudix/` parent dir for us.
 */
export const PROFILE_DATA_PATH = '.mudix/profile.json';

/** Bumped if the on-disk shape changes incompatibly. */
const PROFILE_DATA_VERSION = 1;

export interface PersistedProfileData {
    version: number;
    scripts: ScriptNode[];
    aliases: AliasNode[];
    triggers: TriggerNode[];
    timers: TimerNode[];
    keybindings: KeyNode[];
    buttons: ButtonNode[];
    packages: PackageManifest[];
}

/**
 * Read `.mudix/profile.json` from the profile VFS and push it into the store
 * for `connectionId`. No-op when the file is missing (fresh profile) or
 * unparseable — a corrupt file shouldn't take the whole profile down; the
 * store simply keeps the empty defaults.
 */
export function loadProfileData(vfs: ProfileVFS, connectionId: string): void {
    if (!vfs.exists(PROFILE_DATA_PATH)) return;
    let data: Partial<PersistedProfileData>;
    try {
        data = JSON.parse(vfs.readFile(PROFILE_DATA_PATH)) as Partial<PersistedProfileData>;
    } catch (err) {
        console.warn('[profileVfsData] failed to parse', PROFILE_DATA_PATH, err);
        return;
    }
    useAppStore.getState().hydrateConnectionData(connectionId, data);
}

/** Serialize the seven automation slices for `connectionId` from the live store. */
export function serializeProfileData(connectionId: string): string {
    const s = useAppStore.getState();
    const payload: PersistedProfileData = {
        version: PROFILE_DATA_VERSION,
        scripts: s.connectionScripts[connectionId] ?? [],
        aliases: s.connectionAliases[connectionId] ?? [],
        triggers: s.connectionTriggers[connectionId] ?? [],
        timers: s.connectionTimers[connectionId] ?? [],
        keybindings: s.connectionKeybindings[connectionId] ?? [],
        buttons: s.connectionButtons[connectionId] ?? [],
        packages: s.connectionPackages[connectionId] ?? [],
    };
    return JSON.stringify(payload);
}

/** Write the current store state for `connectionId` to the profile VFS. */
export function saveProfileData(vfs: ProfileVFS, connectionId: string): void {
    vfs.writeFile(PROFILE_DATA_PATH, serializeProfileData(connectionId));
}
