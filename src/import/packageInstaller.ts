import { unzipSync, strFromU8 } from 'fflate';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import type { PackageKind, PackageManifest } from '../storage/schema';
import { parseMudletXml, type MudletImportResult } from './mudletXmlImport';

export interface InstallResult {
    manifest: PackageManifest;
    data: MudletImportResult;
}

export interface InstallOptions {
    /**
     * 'package' (default) — plain XML imports skip VFS storage; only zips are kept on disk.
     * 'module'            — XML on disk is the source of truth: even plain XML is written to the
     *                       VFS so it can be re-parsed on the next profile open and synced to.
     */
    kind?: PackageKind;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — local file header

function looksLikeZip(buf: Uint8Array): boolean {
    if (buf.length < 4) return false;
    return ZIP_MAGIC.every((b, i) => buf[i] === b);
}

/** Strip extension, sanitize for use as a directory name. */
function packageNameFromFile(filename: string): string {
    const base = filename.replace(/\.(mpackage|zip|xml)$/i, '');
    // Replace path separators and other unsafe chars with underscores.
    return base.replace(/[\\/:*?"<>|]/g, '_').trim() || 'package';
}

function isXmlEntry(path: string): boolean {
    return /\.xml$/i.test(path);
}

const TEXT_EXT = /\.(xml|lua|txt|json|md|css|html|htm|js|csv|ini|cfg|conf|yml|yaml)$/i;
function isTextEntry(path: string): boolean {
    return TEXT_EXT.test(path);
}

/**
 * Install a Mudlet package from in-memory bytes. Synchronous — the caller is
 * expected to flush the VFS afterwards (or let the next idle flush handle it).
 *
 * Behaviour by kind:
 * - .mpackage / .zip : always unzipped into <profilePath>/<packageName>/. The full payload
 *                      is preserved so resources (images, sounds, lua modules) remain
 *                      available to scripts via the VFS, regardless of `kind`.
 * - .xml as 'package': parse only — no files written. Nodes live in the app store.
 * - .xml as 'module' : the XML is also written to <profilePath>/<packageName>/<filename>;
 *                      the on-disk file is treated as the source of truth, so it must exist
 *                      to be re-parsed on profile open.
 *
 * The XML is parsed in package-mode, which wraps each category in a top-level
 * group and tags every node with the package name, making uninstall a tag-based cascade.
 */
export function installPackageFromBytes(
    filename: string,
    buf: Uint8Array,
    vfs: ProfileVFS,
    opts: InstallOptions = {},
): InstallResult {
    const kind: PackageKind = opts.kind ?? 'package';
    const packageName = packageNameFromFile(filename);
    const pkgDir = `${vfs.profilePath}/${packageName}`;

    // Wipe any previous install of the same package (re-install is a clean slate).
    if (vfs.exists(pkgDir)) vfs.rmdir(pkgDir);

    let xmlContent: string;
    let xmlRelPath: string | undefined;
    let manifestExtras: Partial<PackageManifest> = {};

    if (looksLikeZip(buf)) {
        vfs.mkdir(pkgDir);

        const entries = unzipSync(buf);
        // Pick the first .xml at any depth — Mudlet places it at the root of the archive.
        const xmlEntry = Object.keys(entries).find(isXmlEntry);
        if (!xmlEntry) throw new Error(`No XML file found inside ${filename}`);
        xmlContent = strFromU8(entries[xmlEntry]);
        xmlRelPath = xmlEntry;

        // Write every entry to VFS preserving the archive's directory layout.
        for (const [path, data] of Object.entries(entries)) {
            // Skip the directory placeholders that some zippers emit.
            if (path.endsWith('/')) {
                vfs.mkdir(`${pkgDir}/${path}`);
                continue;
            }
            const dest = `${pkgDir}/${path}`;
            const parent = dest.substring(0, dest.lastIndexOf('/'));
            if (parent && !vfs.exists(parent)) vfs.mkdir(parent);
            if (isTextEntry(path)) vfs.writeFile(dest, strFromU8(data));
            else                   vfs.writeBinaryFile(dest, data);
        }

        manifestExtras = readConfigLua(entries);
    } else {
        xmlContent = strFromU8(buf);
        if (kind === 'module') {
            // Modules need an on-disk XML to reload from on profile open.
            vfs.mkdir(pkgDir);
            vfs.writeFile(`${pkgDir}/${filename}`, xmlContent);
            xmlRelPath = filename;
        }
        // Plain XML packages keep nothing on disk.
    }

    const data = parseMudletXml(xmlContent, { packageName });

    const manifest: PackageManifest = {
        name: packageName,
        ...manifestExtras,
        ...(xmlRelPath ? { xmlPath: xmlRelPath } : {}),
        sourceFile: filename,
        installedAt: new Date().toISOString(),
        ...(kind === 'module' ? { kind: 'module' as const, sync: false } : {}),
    };

    return { manifest, data };
}

/** Async wrapper that reads from a File and flushes the VFS to disk on success. */
export async function installPackageFromFile(file: File, vfs: ProfileVFS, opts: InstallOptions = {}): Promise<InstallResult> {
    const buf = new Uint8Array(await file.arrayBuffer());
    const result = installPackageFromBytes(file.name, buf, vfs, opts);
    await vfs.flush();
    return result;
}

/**
 * Parse a Lua string literal beginning at `start` in `text`. Supports:
 *   - "..." / '...'   with simple backslash escapes
 *   - [[ ... ]] and [=*[ ... ]=*]  long-bracket strings (multi-line)
 *
 * Returns the unquoted value and the index just past the closing delimiter,
 * or null if the position doesn't begin a recognizable string literal.
 */
function parseLuaString(text: string, start: number): { value: string; end: number } | null {
    let i = start;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
    if (i >= text.length) return null;

    const ch = text[i];
    if (ch === '"' || ch === "'") {
        let j = i + 1;
        let out = '';
        while (j < text.length && text[j] !== ch) {
            if (text[j] === '\\' && j + 1 < text.length) {
                const esc = text[j + 1];
                out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '\r' : esc;
                j += 2;
            } else {
                out += text[j];
                j++;
            }
        }
        return { value: out, end: j + 1 };
    }

    if (ch === '[') {
        // [=*[ … ]=*]
        let j = i + 1;
        let level = 0;
        while (text[j] === '=') { level++; j++; }
        if (text[j] !== '[') return null;
        j++;
        // Lua spec: a leading newline immediately after the opener is stripped.
        if (text[j] === '\r' && text[j + 1] === '\n') j += 2;
        else if (text[j] === '\n' || text[j] === '\r') j++;
        const closer = ']' + '='.repeat(level) + ']';
        const end = text.indexOf(closer, j);
        if (end < 0) return null;
        return { value: text.slice(j, end), end: end + closer.length };
    }

    return null;
}

/** Best-effort parse of Mudlet's config.lua for manifest metadata. */
function readConfigLua(entries: Record<string, Uint8Array>): Partial<PackageManifest> {
    const cfgKey = Object.keys(entries).find(k => /(?:^|\/)config\.lua$/i.test(k));
    if (!cfgKey) return {};
    const out: Partial<PackageManifest> = {};
    const text = strFromU8(entries[cfgKey]);

    const keyRe = /^[ \t]*(\w+)[ \t]*=[ \t]*/gm;
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(text)) !== null) {
        const parsed = parseLuaString(text, keyRe.lastIndex);
        if (!parsed) continue;
        keyRe.lastIndex = parsed.end;

        const key = m[1].toLowerCase();
        const val = parsed.value;
        if      (key === 'mpackage' || key === 'name' || key === 'package') out.name = val || out.name;
        else if (key === 'version')                                         out.version = val;
        else if (key === 'author')                                          out.author = val;
        else if (key === 'title')                                           out.title = val;
        else if (key === 'description')                                     out.description = val;
        else if (key === 'icon')                                            out.icon = val;
        else if (key === 'created')                                         out.created = val;
    }
    return out;
}

/** Remove the on-disk package directory. The store handles tag-based node removal. */
export async function uninstallPackageFiles(packageName: string, vfs: ProfileVFS): Promise<void> {
    const pkgDir = `${vfs.profilePath}/${packageName}`;
    if (vfs.exists(pkgDir)) vfs.rmdir(pkgDir);
    await vfs.flush();
}

/**
 * Re-read a module's XML from the VFS and return the parsed result.
 * Throws if the on-disk file is missing — modules require their XML to be present.
 */
export function reloadModuleFromVfs(manifest: PackageManifest, vfs: ProfileVFS): MudletImportResult {
    if (!manifest.xmlPath) {
        throw new Error(`Module "${manifest.name}" has no xmlPath; cannot reload from disk`);
    }
    const path = `${vfs.profilePath}/${manifest.name}/${manifest.xmlPath}`;
    if (!vfs.exists(path)) {
        throw new Error(`Module "${manifest.name}" XML not found at ${path}`);
    }
    const xmlContent = vfs.readFile(path);
    return parseMudletXml(xmlContent, { packageName: manifest.name });
}
