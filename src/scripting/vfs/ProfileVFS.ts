import {
    configure,
    InMemory,
    mount,
    umount,
    resolveMountConfig,
    readFileSync,
    writeFileSync,
    appendFileSync,
    mkdirSync,
    rmdirSync,
    readdirSync,
    statSync,
    existsSync,
    unlinkSync,
    rmSync,
    renameSync,
    type FileSystem,
} from '@zenfs/core';
import { IndexedDB, WebAccess } from '@zenfs/dom';
import { checkFolderPermission, loadFolderHandle } from './folderHandleStore';

let rootReady: Promise<void> | null = null;

function ensureRoot(): Promise<void> {
    if (!rootReady) {
        rootReady = configure({ mounts: { '/': InMemory } });
    }
    return rootReady;
}

export type VFSSource = 'folder' | 'idb';

// AsyncMixin exposes sync(), but it isn't on FileSystem's public type.
type Syncable = FileSystem & { sync?: () => Promise<void> };

export class ProfileVFS {
    readonly profilePath: string;
    private _cwd: string;
    private _fs: Syncable;
    private _handle?: FileSystemDirectoryHandle;
    readonly source: VFSSource;
    readonly folderName?: string;

    private constructor(
        readonly connectionId: string,
        fs: Syncable,
        source: VFSSource,
        handle?: FileSystemDirectoryHandle,
    ) {
        this.profilePath = `/profiles/${connectionId}`;
        this._cwd = this.profilePath;
        this._fs = fs;
        this._handle = handle;
        this.source = source;
        this.folderName = handle?.name;
    }

    static async mount(connectionId: string): Promise<ProfileVFS> {
        await ensureRoot();
        const profilePath = `/profiles/${connectionId}`;

        // Prefer a linked folder if the user previously picked one and the
        // browser still grants us readwrite permission without a fresh prompt.
        // Permission prompts require a user gesture, so on cold start we can
        // only use the folder when the grant is already 'granted'. Anything
        // else falls back silently to IDB; the UI surfaces a re-link affordance.
        const handle = await loadFolderHandle(connectionId).catch(() => null);
        if (handle) {
            const perm = await checkFolderPermission(handle);
            if (perm === 'granted') {
                try {
                    const fs = await resolveMountConfig({ backend: WebAccess, handle }) as Syncable;
                    mount(profilePath, fs);
                    return new ProfileVFS(connectionId, fs, 'folder', handle);
                } catch (err) {
                    console.warn('[ProfileVFS] folder mount failed, falling back to IDB:', err);
                }
            }
        }

        const fs = await resolveMountConfig({ backend: IndexedDB, storeName: `mudix_vfs_${connectionId}` }) as Syncable;
        mount(profilePath, fs);
        if (!existsSync(profilePath)) {
            mkdirSync(profilePath, { recursive: true });
        }
        return new ProfileVFS(connectionId, fs, 'idb');
    }

    get cwd(): string { return this._cwd; }

    resolvePath(path: string): string {
        const abs = path.startsWith('/') ? path : `${this._cwd}/${path}`;
        return normalizePath(abs);
    }

    exists(path: string): boolean {
        try { return existsSync(this.resolvePath(path)); } catch { return false; }
    }

    readFile(path: string): string {
        return readFileSync(this.resolvePath(path), 'utf8') as string;
    }

    readBinaryFile(path: string): Uint8Array {
        return readFileSync(this.resolvePath(path)) as unknown as Uint8Array;
    }

    writeFile(path: string, content: string): void {
        const abs = this.resolvePath(path);
        ensureParentDir(abs);
        writeFileSync(abs, content, 'utf8');
    }

    writeBinaryFile(path: string, data: Uint8Array): void {
        const abs = this.resolvePath(path);
        ensureParentDir(abs);
        writeFileSync(abs, data);
    }

    appendFile(path: string, content: string): void {
        const abs = this.resolvePath(path);
        ensureParentDir(abs);
        appendFileSync(abs, content, 'utf8');
    }

    deleteFile(path: string): void {
        unlinkSync(this.resolvePath(path));
    }

    rename(oldPath: string, newPath: string): void {
        const absNew = this.resolvePath(newPath);
        ensureParentDir(absNew);
        renameSync(this.resolvePath(oldPath), absNew);
    }

    mkdir(path: string): void {
        mkdirSync(this.resolvePath(path), { recursive: true });
    }

    rmdir(path: string): void {
        const abs = this.resolvePath(path);
        try {
            rmdirSync(abs);
        } catch {
            rmSync(abs, { recursive: true, force: true });
        }
    }

    readdir(path: string): string[] {
        return readdirSync(this.resolvePath(path)) as string[];
    }

    stat(path: string): { type: 'file' | 'dir'; size: number; mtime: Date; atime: Date } | null {
        try {
            const s = statSync(this.resolvePath(path));
            return {
                type: s.isDirectory() ? 'dir' : 'file',
                size: s.size,
                mtime: new Date(s.mtimeMs),
                atime: new Date(s.atimeMs),
            };
        } catch { return null; }
    }

    chdir(path: string): string | null {
        const abs = this.resolvePath(path);
        try {
            const s = statSync(abs);
            if (!s.isDirectory()) return 'not a directory';
            this._cwd = abs;
            return null;
        } catch { return 'no such directory'; }
    }

    /**
     * Drain queued async writes to the underlying backend. For folder-backed
     * mounts this writes RAM-cached changes through to disk; for IDB mounts
     * it persists to IndexedDB. Safe to call on any source.
     */
    async flush(): Promise<void> {
        if (typeof this._fs.sync === 'function') {
            try { await this._fs.sync(); } catch (err) { console.warn('[ProfileVFS] flush failed:', err); }
        }
    }

    /**
     * Re-walk the linked directory and rebuild the in-memory cache. Use after
     * external edits (file added/changed in the OS file manager). No-op for
     * IDB-backed profiles since their state is owned by the browser.
     *
     * Any Lua file handles opened before resync become invalid: ZenFS replaces
     * the underlying FS instance, so subsequent reads on those handles will
     * error. New `io.open` calls work normally.
     */
    async resync(): Promise<void> {
        if (this.source !== 'folder' || !this._handle) return;
        await this.flush();
        try { umount(this.profilePath); } catch { /* not mounted */ }
        const fs = await resolveMountConfig({ backend: WebAccess, handle: this._handle }) as Syncable;
        mount(this.profilePath, fs);
        this._fs = fs;
    }

    unmount(): void {
        try { umount(this.profilePath); } catch { /* already unmounted */ }
    }
}

function normalizePath(path: string): string {
    const parts = path.split('/');
    const out: string[] = [];
    for (const p of parts) {
        if (p === '' || p === '.') continue;
        if (p === '..') { out.pop(); continue; }
        out.push(p);
    }
    return '/' + out.join('/');
}

function ensureParentDir(absPath: string): void {
    const parent = absPath.substring(0, absPath.lastIndexOf('/'));
    if (parent && !existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
    }
}
