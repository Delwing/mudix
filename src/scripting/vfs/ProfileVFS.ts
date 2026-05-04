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
} from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';

let rootReady: Promise<void> | null = null;

function ensureRoot(): Promise<void> {
    if (!rootReady) {
        rootReady = configure({ mounts: { '/': InMemory } });
    }
    return rootReady;
}

export class ProfileVFS {
    readonly profilePath: string;
    private _cwd: string;

    private constructor(readonly connectionId: string) {
        this.profilePath = `/profiles/${connectionId}`;
        this._cwd = this.profilePath;
    }

    static async mount(connectionId: string): Promise<ProfileVFS> {
        await ensureRoot();
        const vfs = new ProfileVFS(connectionId);
        const fs = await resolveMountConfig({ backend: IndexedDB, storeName: `mudix_vfs_${connectionId}` });
        await mount(vfs.profilePath, fs);
        // Ensure profile root exists inside the mounted FS
        if (!existsSync(vfs.profilePath)) {
            mkdirSync(vfs.profilePath, { recursive: true });
        }
        return vfs;
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

    writeFile(path: string, content: string): void {
        const abs = this.resolvePath(path);
        ensureParentDir(abs);
        writeFileSync(abs, content, 'utf8');
    }

    appendFile(path: string, content: string): void {
        const abs = this.resolvePath(path);
        ensureParentDir(abs);
        appendFileSync(abs, content, 'utf8');
    }

    deleteFile(path: string): void {
        unlinkSync(this.resolvePath(path));
    }

    mkdir(path: string): void {
        mkdirSync(this.resolvePath(path), { recursive: true });
    }

    rmdir(path: string): void {
        const abs = this.resolvePath(path);
        try {
            rmdirSync(abs);
        } catch {
            // Fall back to recursive rm if not empty
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
