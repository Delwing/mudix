import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../src/storage/appStore';
import {
    loadProfileData,
    saveProfileData,
    PROFILE_DATA_PATH,
} from '../../src/storage/profileVfsData';
import type { ProfileVFS } from '../../src/scripting/vfs/ProfileVFS';

// profileVfsData only touches three ProfileVFS methods, so a Map-backed stub is
// enough to exercise the store <-> JSON round-trip without ZenFS/IndexedDB.
function fakeVfs(): ProfileVFS {
    const files = new Map<string, string>();
    return {
        exists: (p: string) => files.has(p),
        readFile: (p: string) => {
            const v = files.get(p);
            if (v === undefined) throw new Error(`ENOENT: ${p}`);
            return v;
        },
        writeFile: (p: string, content: string) => { files.set(p, content); },
    } as unknown as ProfileVFS;
}

const CONN = 'test-conn';

describe('profileVfsData', () => {
    beforeEach(() => {
        useAppStore.getState().hydrateConnectionData(CONN, {});
    });

    it('round-trips automation slices through the profile VFS', () => {
        const vfs = fakeVfs();
        const store = useAppStore.getState();

        store.addAlias(CONN, {
            name: 'greet', enabled: true, isGroup: false, parentId: null,
            pattern: '^hi$', command: 'say hello', code: '', language: 'lua',
        });
        store.addButton(CONN, {
            name: 'attack', enabled: true, isGroup: false, parentId: null,
            orientation: 'horizontal', location: 'top', columns: 0,
            isPushDown: false, buttonState: false, code: '', language: 'lua',
            command: 'kill rat',
        });

        saveProfileData(vfs, CONN);
        expect(vfs.exists(PROFILE_DATA_PATH)).toBe(true);
        const parsed = JSON.parse(vfs.readFile(PROFILE_DATA_PATH));
        expect(parsed.version).toBe(1);
        expect(parsed.aliases).toHaveLength(1);
        expect(parsed.buttons).toHaveLength(1);

        // Wipe in-memory state, then reload from the VFS.
        useAppStore.getState().hydrateConnectionData(CONN, {});
        expect(useAppStore.getState().connectionAliases[CONN]).toEqual([]);

        loadProfileData(vfs, CONN);
        const after = useAppStore.getState();
        expect(after.connectionAliases[CONN]).toHaveLength(1);
        expect(after.connectionAliases[CONN][0].command).toBe('say hello');
        expect(after.connectionButtons[CONN]).toHaveLength(1);
        expect(after.connectionButtons[CONN][0].name).toBe('attack');
    });

    it('loadProfileData is a no-op when the file is absent', () => {
        const vfs = fakeVfs();
        useAppStore.getState().addAlias(CONN, {
            name: 'keep', enabled: true, isGroup: false, parentId: null,
            pattern: 'x', command: 'y', code: '', language: 'lua',
        });
        loadProfileData(vfs, CONN); // no .mudix/profile.json present
        // Absent file must not clobber existing in-memory state.
        expect(useAppStore.getState().connectionAliases[CONN]).toHaveLength(1);
    });

    it('loadProfileData ignores a corrupt file', () => {
        const vfs = fakeVfs();
        vfs.writeFile(PROFILE_DATA_PATH, '{ not json');
        expect(() => loadProfileData(vfs, CONN)).not.toThrow();
        expect(useAppStore.getState().connectionAliases[CONN]).toEqual([]);
    });
});
