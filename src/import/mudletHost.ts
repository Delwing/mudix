import type { ProfileSettings, ProtocolSettings } from '../storage/schema';
import { parseMudletXml, type MudletImportResult } from './mudletXmlImport';
import { parseVariablePackageXml, type MudletVariablePackage } from './mudletVariables';

// Maps the `<HostPackage><Host>` block of a Mudlet profile XML onto mudix's
// ProfileSettings. This is the settings half of a full Mudlet-profile import —
// the automation half is parseMudletXml, the saved-variables half is
// parseVariablePackageXml. Only fields with a mudix home are mapped; the rest of
// Host (spell dictionary, profile shortcuts, Discord, MMCP, …) is ignored.

function childText(host: Element, tag: string): string | undefined {
    const el = host.querySelector(`:scope > ${tag}`);
    const t = el?.textContent?.trim();
    return t ? t : undefined;
}

/** Telnet protocol toggles live as `yes`/`no` attributes on the <Host> element. */
function attrBool(host: Element, attr: string): boolean | undefined {
    const v = host.getAttribute(attr);
    return v == null ? undefined : v === 'yes';
}

function attrNum(host: Element, attr: string): number | undefined {
    const v = host.getAttribute(attr);
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

// Mudlet color element name → ansiPalette index. mudix's palette is 0–7 dark
// (black,red,green,yellow,blue,magenta,cyan,white) then 8–15 bright; Mudlet
// names them mBlack/mLightBlack/… so the indices are interleaved relative to
// Mudlet's own document order.
const ANSI_COLOR_INDEX: ReadonlyArray<readonly [string, number]> = [
    ['mBlack', 0], ['mRed', 1], ['mGreen', 2], ['mYellow', 3],
    ['mBlue', 4], ['mMagenta', 5], ['mCyan', 6], ['mWhite', 7],
    ['mLightBlack', 8], ['mLightRed', 9], ['mLightGreen', 10], ['mLightYellow', 11],
    ['mLightBlue', 12], ['mLightMagenta', 13], ['mLightCyan', 14], ['mLightWhite', 15],
];

// Mudlet's `<Host mEnableX>` attribute → mudix ProtocolSettings field.
const PROTOCOL_ATTR: ReadonlyArray<readonly [string, keyof ProtocolSettings]> = [
    ['mEnableGMCP', 'gmcp'], ['mEnableMSDP', 'msdp'], ['mEnableMSSP', 'mssp'],
    ['mEnableMSP', 'msp'], ['mEnableMTTS', 'mtts'], ['mEnableMNES', 'mnes'],
    ['mEnableMXP', 'mxp'], ['mEnableNAWS', 'naws'], ['mEnableCHARSET', 'charset'],
    ['mEnableNEWENVIRON', 'newEnviron'],
];

// Mudlet's mDisplayFont is "Family,pointSize,…" (a serialized QFont). We only
// want the family and size.
function parseFontSpec(spec: string): { family?: string; size?: number } {
    const parts = spec.split(',');
    const family = parts[0]?.trim() || undefined;
    const size = parts[1] !== undefined ? Number(parts[1]) : undefined;
    return { family, size: Number.isFinite(size as number) ? size : undefined };
}

/**
 * Map a `<Host>` element to a partial ProfileSettings. Only keys actually
 * present in the XML are set, so the result can be merged over existing/default
 * settings without clobbering anything Mudlet didn't specify.
 */
export function parseMudletHost(host: Element): Partial<ProfileSettings> {
    const out: Partial<ProfileSettings> = {};

    // ── command line / wrap ──────────────────────────────────────────────
    const sep = childText(host, 'mCommandSeparator');
    if (sep !== undefined) out.commandSeparator = sep;
    const autoClear = attrBool(host, 'autoClearCommandLineAfterSend');
    if (autoClear !== undefined) out.autoClearInput = autoClear;
    const wrapAt = childText(host, 'wrapAt');
    if (wrapAt !== undefined && Number.isFinite(Number(wrapAt))) out.outputWrapAt = Number(wrapAt);
    const wrapIndent = childText(host, 'wrapIndentCount');
    if (wrapIndent !== undefined && Number.isFinite(Number(wrapIndent))) out.outputWrapIndent = Number(wrapIndent);
    const wrapHanging = childText(host, 'wrapHangingIndentCount');
    if (wrapHanging !== undefined && Number.isFinite(Number(wrapHanging))) out.outputWrapHangingIndent = Number(wrapHanging);

    // ── colors ───────────────────────────────────────────────────────────
    const fg = childText(host, 'mFgColor');
    if (fg) out.outputForeground = fg;
    const bg = childText(host, 'mBgColor');
    if (bg) out.outputBackground = bg;
    const cmdFg = childText(host, 'mCommandFgColor');
    if (cmdFg) out.commandEchoForeground = cmdFg;
    const cmdBg = childText(host, 'mCommandBgColor');
    if (cmdBg) out.commandEchoBackground = cmdBg;
    const inputFg = childText(host, 'mCommandLineFgColor');
    if (inputFg) out.inputForeground = inputFg;
    const inputBg = childText(host, 'mCommandLineBgColor');
    if (inputBg) out.inputBackground = inputBg;

    const palette: (string | undefined)[] = new Array(16);
    let anyColor = false;
    for (const [name, idx] of ANSI_COLOR_INDEX) {
        const c = childText(host, name);
        if (c) { palette[idx] = c; anyColor = true; }
    }
    if (anyColor) out.ansiPalette = palette;

    const redefine = attrBool(host, 'mServerMayRedefineColors');
    if (redefine !== undefined) out.serverRedefineColors = redefine;

    // ── borders ──────────────────────────────────────────────────────────
    const top = Number(childText(host, 'borderTopHeight') ?? '');
    const bottom = Number(childText(host, 'borderBottomHeight') ?? '');
    const left = Number(childText(host, 'borderLeftWidth') ?? '');
    const right = Number(childText(host, 'borderRightWidth') ?? '');
    if ([top, bottom, left, right].some(n => Number.isFinite(n) && n > 0)) {
        out.outputBorders = {
            top: Number.isFinite(top) ? top : 0,
            bottom: Number.isFinite(bottom) ? bottom : 0,
            left: Number.isFinite(left) ? left : 0,
            right: Number.isFinite(right) ? right : 0,
        };
    }

    // ── font ─────────────────────────────────────────────────────────────
    const fontSpec = childText(host, 'mDisplayFont');
    if (fontSpec) {
        const { family, size } = parseFontSpec(fontSpec);
        if (family) out.outputFont = { kind: 'system', family };
        if (size !== undefined) out.fontSize = size;
    }

    // ── network / prompt ─────────────────────────────────────────────────
    const timeout = attrNum(host, 'NetworkPacketTimeout');
    if (timeout !== undefined) out.promptTimeoutMs = timeout;

    // ── protocols ────────────────────────────────────────────────────────
    const protocols: ProtocolSettings = {};
    let anyProtocol = false;
    for (const [attr, key] of PROTOCOL_ATTR) {
        const v = attrBool(host, attr);
        if (v !== undefined) { protocols[key] = v; anyProtocol = true; }
    }
    if (anyProtocol) out.protocols = protocols;

    return out;
}

/** The connection identity a Mudlet `<Host>` carries: the profile name and the
 *  MUD address (`<url>` host + `<port>`). Used to seed a new mudix connection. */
export interface MudletProfileIdentity {
    name?: string;
    host?: string;
    port?: number;
}

/** Read `<name>`/`<url>`/`<port>` (direct children of `<Host>`). */
export function parseMudletHostIdentity(host: Element): MudletProfileIdentity {
    const out: MudletProfileIdentity = {};
    const name = childText(host, 'name');
    if (name) out.name = name;
    const url = childText(host, 'url');
    if (url) out.host = url;
    const port = childText(host, 'port');
    if (port !== undefined && Number.isFinite(Number(port))) out.port = Number(port);
    return out;
}

/** Names from `<Host><mInstalledPackages>` — the packages Mudlet considers
 *  installed for this profile. Mudlet tracks these so package managers (mpkg) and
 *  `getPackageInfo`/`getInstalledPackages` work; mudix registers a manifest per
 *  entry on import. */
export function parseInstalledPackages(host: Element): string[] {
    const list = host.querySelector(':scope > mInstalledPackages');
    if (!list) return [];
    return Array.from(list.querySelectorAll(':scope > string'))
        .map(s => s.textContent?.trim() ?? '')
        .filter(Boolean);
}

/** Everything a full Mudlet profile XML carries that mudix can import. */
export interface MudletProfileImport {
    /** From `<Host>` — the profile name + MUD address for the connection record. */
    connection: MudletProfileIdentity;
    /** From `<HostPackage><Host>` — partial so it merges over defaults. */
    settings: Partial<ProfileSettings>;
    /** From the Trigger/Alias/Script/Timer/Key/Action packages. */
    automation: MudletImportResult;
    /** From `<VariablePackage>` — the saved-variables tree + hidden list. */
    variables: MudletVariablePackage;
    /** Names from `<mInstalledPackages>` — registered as package manifests on import. */
    installedPackages: string[];
    /** From `<mInstalledModules>` — modules reference an XML file at an absolute
     *  local path *outside* the profile, which a browser can't read. The import
     *  flow surfaces these for the user to upload or drop. */
    modules: MudletModuleRef[];
}

/** One `<mInstalledModules>` entry: a module the profile loads from an external
 *  XML file on the user's disk. */
export interface MudletModuleRef {
    key: string;
    filepath: string;
    /** Mudlet `globalSave` flag — sync the module back on save. */
    globalSave: boolean;
    priority: number;
}

/** Parse the repeated `<mInstalledModules>` blocks under `<Host>`. */
export function parseInstalledModules(host: Element): MudletModuleRef[] {
    return Array.from(host.children)
        .filter(c => c.tagName === 'mInstalledModules')
        .map(el => ({
            key: childText(el, 'key') ?? '',
            filepath: childText(el, 'filepath') ?? '',
            globalSave: (childText(el, 'globalSave') ?? '0') !== '0',
            priority: Number(childText(el, 'priority') ?? '0') || 0,
        }))
        .filter(m => m.key);
}

/**
 * Parse a complete Mudlet profile XML (a `current/*.xml`) into the things mudix
 * can apply: the connection identity, profile settings, automation trees, and
 * saved variables. `<VariablePackage>` variable names become the seed of the
 * profile's save-list when applied. Throws on malformed XML.
 */
export function parseMudletProfile(xml: string): MudletProfileImport {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error(`XML parse error: ${err.textContent?.split('\n')[0]}`);
    const host = doc.getElementsByTagName('Host')[0];
    return {
        connection: host ? parseMudletHostIdentity(host) : {},
        settings: host ? parseMudletHost(host) : {},
        automation: parseMudletXml(xml),
        variables: parseVariablePackageXml(xml),
        installedPackages: host ? parseInstalledPackages(host) : [],
        modules: host ? parseInstalledModules(host) : [],
    };
}
