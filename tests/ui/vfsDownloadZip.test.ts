import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { collectZipEntries } from '../../src/ui/FileBrowserModal';
import type { ProfileVFS } from '../../src/scripting/vfs/ProfileVFS';

/**
 * The Files browser's "download folder / whole profile as .zip" action walks the
 * VFS with collectZipEntries. These tests pin the layout it produces: paths are
 * relative to the downloaded root, empty directories survive, and unreadable
 * files are skipped rather than aborting the export.
 */

interface StubEntry { type: 'file' | 'dir'; bytes?: Uint8Array; unreadable?: boolean }

/** In-memory stand-in for ProfileVFS covering readdir/stat/readBinaryFile. */
class StubVFS {
    profilePath = '/profiles/test';
    entries = new Map<string, StubEntry>();

    dir(path: string): this {
        this.entries.set(path, { type: 'dir' });
        return this;
    }
    file(path: string, content: string | Uint8Array, unreadable = false): this {
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
        this.entries.set(path, { type: 'file', bytes, unreadable });
        return this;
    }
    readdir(path: string): string[] {
        const prefix = `${path}/`;
        const names: string[] = [];
        for (const key of this.entries.keys()) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.substring(prefix.length);
            if (!rest.includes('/')) names.push(rest);
        }
        return names.sort();
    }
    stat(path: string): { type: 'file' | 'dir'; size: number } | null {
        const e = this.entries.get(path);
        if (!e) return null;
        return { type: e.type, size: e.bytes?.byteLength ?? 0 };
    }
    readBinaryFile(path: string): Uint8Array {
        const e = this.entries.get(path);
        if (!e || e.type !== 'file') throw new Error(`ENOENT: ${path}`);
        if (e.unreadable) throw new Error(`EIO: ${path}`);
        return e.bytes!;
    }
}

function makeVfs(): StubVFS {
    return new StubVFS()
        .file('/profiles/test/config.lua', 'return {}')
        .dir('/profiles/test/scripts')
        .file('/profiles/test/scripts/main.lua', 'send("hi")')
        .dir('/profiles/test/scripts/lib')
        .file('/profiles/test/scripts/lib/util.lua', 'return 1')
        .dir('/profiles/test/sounds');   // deliberately empty
}

function collect(vfs: StubVFS, root: string): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    collectZipEntries(vfs as unknown as ProfileVFS, root, '', out);
    return out;
}

describe('collectZipEntries', () => {
    it('flattens the whole profile with paths relative to the root', () => {
        const out = collect(makeVfs(), '/profiles/test');
        expect(Object.keys(out).sort()).toEqual([
            'config.lua',
            'scripts/lib/util.lua',
            'scripts/main.lua',
            'sounds/',
        ]);
        expect(strFromU8(out['scripts/main.lua'])).toBe('send("hi")');
    });

    it('keeps empty directories as explicit dir entries', () => {
        const out = collect(makeVfs(), '/profiles/test');
        expect(out['sounds/']).toBeInstanceOf(Uint8Array);
        expect(out['sounds/'].byteLength).toBe(0);
    });

    it('scopes a subdirectory download to that directory', () => {
        const out = collect(makeVfs(), '/profiles/test/scripts');
        expect(Object.keys(out).sort()).toEqual(['lib/util.lua', 'main.lua']);
    });

    it('skips unreadable files instead of failing the export', () => {
        const vfs = makeVfs().file('/profiles/test/broken.bin', new Uint8Array([1]), true);
        const out = collect(vfs, '/profiles/test');
        expect(out['broken.bin']).toBeUndefined();
        expect(out['config.lua']).toBeDefined();
    });

    it('produces an archive fflate can read back', () => {
        const out = collect(makeVfs(), '/profiles/test');
        const unzipped = unzipSync(zipSync(out, { level: 6 }));
        expect(strFromU8(unzipped['scripts/lib/util.lua'])).toBe('return 1');
        expect(strFromU8(unzipped['config.lua'])).toBe('return {}');
    });

    it('handles a missing or unreadable directory as empty', () => {
        const out = collect(makeVfs(), '/profiles/test/nope');
        expect(out).toEqual({});
    });
});
