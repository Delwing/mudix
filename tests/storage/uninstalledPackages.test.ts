import { describe, it, expect } from 'vitest';
import { useAppStore } from '../../src/storage/appStore';
import type { PackageManifest } from '../../src/storage/schema';

const manifest = (name: string): PackageManifest => ({ name, installedAt: '2026-07-06T00:00:00Z' });
const emptyData = { scripts: [], aliases: [], triggers: [], timers: [], keys: [], buttons: [], warnings: [] };

// Unique connection ids per test — the zustand store is module-global.
describe('uninstalled-package tombstones', () => {
    it('records an uninstall in the profile settings', () => {
        const id = 'tomb-record';
        const s = useAppStore.getState();
        s.installPackage(id, manifest('run-lua-code'), emptyData);
        s.uninstallPackage(id, 'run-lua-code');
        expect(useAppStore.getState().connectionProfile[id]?.uninstalledPackages).toEqual(['run-lua-code']);
        expect(useAppStore.getState().connectionPackages[id]).toEqual([]);
    });

    it('does not duplicate a tombstone on repeated uninstalls', () => {
        const id = 'tomb-dupe';
        const s = useAppStore.getState();
        s.uninstallPackage(id, 'pkg');
        s.uninstallPackage(id, 'pkg');
        expect(useAppStore.getState().connectionProfile[id]?.uninstalledPackages).toEqual(['pkg']);
    });

    it('clears the tombstone when the package is reinstalled', () => {
        const id = 'tomb-reinstall';
        const s = useAppStore.getState();
        s.uninstallPackage(id, 'run-lua-code');
        s.installPackage(id, manifest('run-lua-code'), emptyData);
        expect(useAppStore.getState().connectionProfile[id]?.uninstalledPackages).toEqual([]);
        expect(useAppStore.getState().connectionPackages[id]?.map(p => p.name)).toEqual(['run-lua-code']);
    });

    it('leaves other profile settings untouched when tombstoning', () => {
        const id = 'tomb-settings';
        const s = useAppStore.getState();
        s.patchConnectionProfile(id, { fontSize: 18 });
        s.uninstallPackage(id, 'pkg');
        expect(useAppStore.getState().connectionProfile[id]?.fontSize).toBe(18);
    });
});
