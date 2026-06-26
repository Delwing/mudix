import { describe, it, expect } from 'vitest';
import { findNewestCurrentXml, isMudletProfileVfs, type VfsReader } from '../../src/import/mudletLink';

// A minimal in-memory VfsReader. `files` maps a relative path to its mtime (ms);
// directories are inferred from the path prefixes.
function mockVfs(files: Record<string, number>): VfsReader {
    const paths = Object.keys(files);
    return {
        exists: (p) => paths.includes(p) || paths.some(f => f.startsWith(`${p}/`)),
        readdir: (p) => {
            const prefix = `${p}/`;
            return [...new Set(paths.filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length).split('/')[0]))];
        },
        stat: (p) => (p in files ? { mtime: new Date(files[p]) } : null),
        readFile: () => '',
    };
}

describe('findNewestCurrentXml', () => {
    it('returns null when there is no current/ directory', () => {
        const vfs = mockVfs({ 'map/2026map': 1 });
        expect(findNewestCurrentXml(vfs)).toBeNull();
        expect(isMudletProfileVfs(vfs)).toBe(false);
    });

    it('picks the most recently modified save', () => {
        const vfs = mockVfs({
            'current/2026-06-26#11-50-18.xml': 1000,
            'current/2026-06-26#11-57-29.xml': 2000,
            'current/autosave.xml': 1500,
        });
        expect(findNewestCurrentXml(vfs)).toBe('current/2026-06-26#11-57-29.xml');
        expect(isMudletProfileVfs(vfs)).toBe(true);
    });

    it('prefers autosave.xml when mtimes are unavailable', () => {
        const vfs = mockVfs({
            'current/2026-06-26#11-50-18.xml': 0,
            'current/autosave.xml': 0,
        });
        expect(findNewestCurrentXml(vfs)).toBe('current/autosave.xml');
    });

    it('falls back to the latest timestamp filename when no mtimes and no autosave', () => {
        const vfs = mockVfs({
            'current/2026-06-26#11-50-18.xml': 0,
            'current/2026-06-26#11-57-29.xml': 0,
        });
        expect(findNewestCurrentXml(vfs)).toBe('current/2026-06-26#11-57-29.xml');
    });

    it('ignores non-xml files in current/', () => {
        const vfs = mockVfs({ 'current/notes.txt': 5000, 'current/save.xml': 1000 });
        expect(findNewestCurrentXml(vfs)).toBe('current/save.xml');
    });
});
