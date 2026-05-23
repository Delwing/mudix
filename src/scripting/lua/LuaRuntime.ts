import {Lua} from 'wasmoon-lua5.1';
import {unzip, strFromU8} from 'fflate';
import type {IScriptingRuntime, CaptureSpan} from '../IScriptingRuntime';
import type {ScriptingAPI} from '../ScriptingAPI';
import type {ProfileVFS} from '../vfs/ProfileVFS';
import UTF8 from './utf8.lua?raw';
import VFS_LUA from './VFS.lua?raw';
import LUAGLOBAL from './LuaGlobal.lua?raw';
import BRIDGE_LUA from './Bridge.lua?raw';
import EXEC_LUA from './Exec.lua?raw';
import LUA_GLOBAL_SETUP from './LuaGlobalSetup.lua?raw';
import LUASQL_LUA from './Luasql.lua?raw';
import {encodeRowsToLuaSource} from './sqlRowEncoder';
import YAJL_LUA from './Yajl.lua?raw';
import {setupRex} from './rex';
import {setupYajl, type LuaValueTransform} from './yajl';
import {getSqliteClient, sqliteReady} from '../../db/sqliteClient';
import {QT_CURSOR_NAME_TO_INT, QT_CURSOR_TO_CSS} from '../../ui/labels/cursorShapes';
import {qtKeyToDomCode, qtModifiersToList} from '../../mud/keybindings/qtKeys';
import {HttpService} from '../http/HttpService';

// All *.lua and *.json files under mudlet-lua/ are served via the VFS at
// /lua/<relative-path>. Adding a new file to the directory tree automatically
// makes it available to dofile() / io.open(). JSON files ship the translation
// data Mudlet's loadTranslations() reads (e.g. /lua/translations/mudlet-lua.json).
const MUDLET_LUA_FILES = import.meta.glob('./mudlet-lua/**/*.{lua,json}', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const DOCKMAP: Record<string, string> = {
    r: 'right',
    l: 'left',
    t: 'top',
    b: 'bottom',
    main: 'main',
}

// Mudlet's HTTP APIs accept Lua header tables of the shape
// `{["Header-Name"] = "value"}`. wasmoon hands these in as a Proxy-wrapped
// LuaTable — Object.keys/bracket access fall through to the JS instance's
// own props (alive/thread/ref/pointer) and the proxy `get` handler tries to
// .bind() the boolean, which throws. $detach(DictType.Object=1) materializes
// the actual Lua keys into a plain object.
function luaTableToHeaders(h: unknown): Record<string, string> | undefined {
    if (!h || typeof h !== 'object') return undefined;
    const proxy = h as { $detach?: (dt: number) => Record<string, unknown> };
    const obj = typeof proxy.$detach === 'function' ? proxy.$detach(1) : (h as Record<string, unknown>);
    const out: Record<string, string> = {};
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v != null) out[k] = String(v);
    }
    return Object.keys(out).length ? out : undefined;
}


export class LuaRuntime implements IScriptingRuntime {

    // Temp alias/trigger IDs → unsub fns (engines return unsub, not numeric IDs).
    private readonly tempIds = new Map<number, () => void>();
    private nextTempId = 1;
    // Tracks label callback ids per slot so re-binds can free the prior Lua-
    // registry slot via __mudix_unregister_cb (avoids the leak the audit flagged
    // for setLabelClickCallback). Outer key: label name, inner key: slot id
    // ("click", "doubleClick", "release", ...). Value: registered cb id or 0
    // when cleared.
    private readonly labelCbIds = new Map<string, Map<string, number>>();
    // Mudlet setCmdLineAction installs at most one Enter-interceptor. Track its
    // cb id so a re-bind frees the prior chunk (same leak fix as label cbs).
    private cmdLineActionCbId = 0;
    // Per-userwindow setCmdLineAction cb ids — same leak-free re-bind logic but
    // keyed by window name. Bound when setCmdLineAction targets a userwindow
    // command line (vs the main command bar). Cleared on disableCommandLine /
    // resetCmdLineAction(name) and when the window is closed.
    private windowCmdLineActionCbIds = new Map<string, number>();
    private currentMatches: string[] = [];
    // selectCaptureGroup needs the actual offset of each capture in the
    // source line; without these spans it falls back to selectString(text, 1)
    // which picks the wrong occurrence when the captured text repeats.
    // Indexed as [cap1Span, cap2Span, ...] — explicit captures only, no
    // full-match entry. Empty when matches come from a non-PCRE source.
    private currentCaptureSpans: CaptureSpan[] = [];
    private currentNamedSpans: Record<string, CaptureSpan> = {};
    // Span of the whole regex match (Mudlet's `selectCaptureGroup(1)` target).
    // Null when the matcher can't produce one (e.g. a perm substring trigger
    // doesn't report a position) — selectCaptureGroup(1) then falls back to
    // selectString on currentMatches[0].
    private currentFullMatchSpan: CaptureSpan | null = null;
    private _denyCurrentSend = false;
    private destroyed = false;
    // Mudlet addFileWatch / removeFileWatch — set of resolved absolute VFS
    // paths. Mutations through the __vfs_* hooks below call
    // notifyVfsPathChange() which fires sysPathChanged. Browser has no native
    // FS notifier, so this only catches Lua-driven changes; external edits to
    // a linked folder still need a ProfileVFS.resync() to be observed.
    private readonly watchedPaths = new Set<string>();
    private http!: HttpService;
    // Set by setupSqlBridge — forces every debounced SQL VFS snapshot to write
    // immediately. Called from saveProfile() so user code can ensure SQL state
    // is durable before the default 500 ms debounce window elapses.
    private flushPendingSqlSnapshots: () => void = () => {};
    // Same JSON→Lua remap yajl uses (1-indexed arrays, null sentinel).
    // Captured here so setGmcpValue can shape incoming GMCP payloads
    // identically to Mudlet's `gmcp` global.
    private toLuaValue: LuaValueTransform = v => v;

    private constructor(
        private readonly lua: Lua,
        private readonly api: ScriptingAPI,
        private vfs: ProfileVFS | null = null,
        private readonly proxyUrlGetter: () => string | undefined = () => undefined,
    ) {
    }

    static async create(
        api: ScriptingAPI,
        vfs: ProfileVFS | null = null,
        proxyUrlGetter: () => string | undefined = () => undefined,
    ): Promise<LuaRuntime> {
        const lua = await Lua.create();
        const rt = new LuaRuntime(lua, api, vfs, proxyUrlGetter);
        await rt.setup();
        return rt;
    }

    private async setup(): Promise<void> {
        // echo([window,] text). Mudlet routes echo to labels when the target
        // name is a label — its HTML is replaced (not appended to).
        this.lua.global.set('echo', (a: string, b?: string) => {
            if (b !== undefined) {
                if (a === 'main') {
                    this.api.echo(b);
                } else if (this.api.labels.has(a)) {
                    this.api.labels.setHtml(a, b);
                } else {
                    this.api.echoToWindow(a, b);
                }
            } else {
                this.api.echo(a);
            }
        });

        // Format state — called by xEcho between text chunks.
        // Lua calling conventions:
        //   setFgColor([win,] r, g, b)
        //   setBgColor([win,] r, g, b, [a])
        // Mudlet validates each channel as integer 0..255; non-finite, negative,
        // or >255 inputs are rejected. We mirror that — invalid args produce a
        // silent no-op (Mudlet logs an error; we can't, so the caller sees the
        // pen unchanged on the next echo).
        const channel = (v: unknown): number | null => {
            const n = Number(v);
            if (!Number.isFinite(n)) return null;
            const i = Math.round(n);
            return i >= 0 && i <= 255 ? i : null;
        };
        this.lua.global.set('setFgColor', (winOrR: unknown, rOrG: unknown, gOrB?: unknown, b?: unknown) => {
            const hasWin = typeof winOrR === 'string';
            const r = channel(hasWin ? rOrG : winOrR);
            const g = channel(hasWin ? gOrB : rOrG);
            const bb = channel(hasWin ? b : gOrB);
            if (r === null || g === null || bb === null) return;
            this.api.setFgColor(r, g, bb, hasWin ? (winOrR as string) : undefined);
        });
        this.lua.global.set('setBgColor', (winOrR: unknown, rOrG: unknown, gOrB?: unknown, b?: unknown, alpha?: unknown) => {
            const hasWin = typeof winOrR === 'string';
            const r = channel(hasWin ? rOrG : winOrR);
            const g = channel(hasWin ? gOrB : rOrG);
            const bb = channel(hasWin ? b : gOrB);
            if (r === null || g === null || bb === null) return;
            const aRaw = hasWin ? alpha : b;
            const a = aRaw !== undefined ? channel(aRaw) : undefined;
            if (aRaw !== undefined && a === null) return;
            this.api.setBgColor(r, g, bb, a ?? undefined, hasWin ? (winOrR as string) : undefined);
        });
        // Mudlet overloads these: setBold(v) or setBold(win, v). Disambiguate by first-arg type.
        const styleSetter = (apply: (v: boolean, win?: string) => void) =>
            (a: unknown, b?: unknown) => {
                if (typeof a === 'string') apply(!!b, a);
                else apply(!!a);
            };
        this.lua.global.set('setBold',      styleSetter((v, w) => this.api.setBold(v, w)));
        this.lua.global.set('setItalics',   styleSetter((v, w) => this.api.setItalic(v, w)));
        this.lua.global.set('setUnderline', styleSetter((v, w) => this.api.setUnderline(v, w)));
        this.lua.global.set('setStrikeOut', styleSetter((v, w) => this.api.setStrikethrough(v, w)));
        this.lua.global.set('resetFormat', (_win?: string) => this.api.resetFormat(_win));

        // Mudlet setTextFormat(windowName, r1, g1, b1, r2, g2, b2, bold,
        // underline, italics, [strikeout], [overline], [reverse], [blinkMode]).
        // r1/g1/b1 is BACKGROUND, r2/g2/b2 is FOREGROUND (Mudlet quirk).
        // Boolean attrs accept boolean or number (non-zero = true) per Mudlet.
        // blinkMode is "none"/"slow"/"fast"; mudix renders slow/rapid blink but
        // has no overline channel — that flag is accepted and silently dropped.
        // Returns true on success, false when the named window doesn't exist.
        const boolOrNum = (v: unknown): boolean => {
            if (typeof v === 'boolean') return v;
            if (typeof v === 'number') return v !== 0;
            return false;
        };
        this.lua.global.set('setTextFormat', (
            winName: unknown,
            r1: unknown, g1: unknown, b1: unknown,
            r2: unknown, g2: unknown, b2: unknown,
            bold: unknown, underline: unknown, italics: unknown,
            strikeout?: unknown, overline?: unknown, reverse?: unknown,
            blinkMode?: unknown,
        ) => {
            const clamp = (v: unknown): number =>
                Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
            const win = typeof winName === 'string' && winName && winName !== 'main' ? winName : undefined;
            const bg = { r: clamp(r1), g: clamp(g1), b: clamp(b1) };
            const fg = { r: clamp(r2), g: clamp(g2), b: clamp(b2) };
            const mode = typeof blinkMode === 'string'
                && (blinkMode === 'slow' || blinkMode === 'fast') ? blinkMode : 'none';
            return this.api.setTextFormat(
                win,
                bg, fg,
                boolOrNum(bold), boolOrNum(underline), boolOrNum(italics),
                boolOrNum(strikeout), boolOrNum(overline), boolOrNum(reverse),
                mode,
            );
        });
        this.lua.global.set('deselect', (win?: string) =>
            this.api.deselect(typeof win === 'string' ? win : undefined),
        );

        this.lua.global.set('getProfileName', () => this.api.profileName);

        this.lua.global.set('getEpoch', () => Date.now() / 1000);

        // Mudlet `getTime([asString, format])`. The Bridge.lua wrapper handles
        // the table-vs-string dispatch and Qt-style format token expansion on
        // top of this raw time record.
        this.lua.global.set('__getTime', () => this.api.getTime());

        // registerAnonymousEventHandler is provided by Bridge.lua — it mirrors
        // Mudlet's C++ TLuaInterpreter::registerAnonymousEventHandler so module-
        // load-time registrations (Geyser etc.) made before Other.lua's Lua-side
        // override land in the native handler table dispatched from
        // __mudix_dispatch_event.

        // raiseEvent runs every handler synchronously. JS is single-threaded
        // so handler-A-before-handler-B ordering falls out of the call stack.
        // Mudlet returns `true` on success (the only failure mode is a missing
        // event name); mudix matches.
        this.lua.global.set('raiseEvent', (event: string, ...args: unknown[]) => {
            if (typeof event !== 'string' || event.length === 0) return false;
            this.emitEvent(event, args);
            return true;
        });

        // Mudlet `windowType(name)` → kind string. Returns `(nil, errMsg)` when
        // the name doesn't resolve. The raw entry point hands JS `null` for the
        // miss case; the Bridge.lua wrapper re-shapes it into the multi-return.
        // mudix has no "buffer", "commandline", or "textedit" concepts, so those
        // kinds are not reported.
        this.lua.global.set('__windowType', (window: unknown) => {
            if (typeof window !== 'string') return null;
            if (window === 'main') return 'main';
            if (this.api.labels.has(window)) return 'label';
            if (this.api.windows.isMiniConsole(window)) return 'miniconsole';
            if (this.api.windows.has(window)) return 'userwindow';
            return null;
        });
        // Mudlet `openUserWindow(name, [restoreLayout, autoDock, dockingArea]) → true`.
        // Always returns true once the window registry has the panel. The handle
        // returned by ScriptingWindowsAPI.open is kept internal — userscripts
        // address windows by name everywhere else (write/move/resize/etc.), so
        // returning `true` (Mudlet shape) avoids leaking the handle object.
        this.lua.global.set('openUserWindow', (window: string, restoreLayout: boolean = true, autoDock: boolean = true, dockingArea: string = 'r') => {
            this.api.windows.open(window, {
                autoDock,
                dockingArea: DOCKMAP[dockingArea] ?? 'right',
                ignoreHint: restoreLayout,
            });
            return true;
        });
        // Mudlet `openMapWidget([dockingArea | x, y [, w, h]]) → true`.
        //   no args            → restore saved layout, or right-dock if none
        //   (area)             → "f" floating, or "l"/"r"/"t"/"b" dock side
        //   (x, y)             → floating at (x, y); width/height inherit the
        //                        saved hint (or panel defaults if none)
        //   (x, y, w, h)       → floating at given pixel position and size
        // Explicit args override the saved layout hint. Always returns true.
        this.lua.global.set('openMapWidget', (a?: unknown, b?: unknown, c?: unknown, d?: unknown) => {
            // 2- or 4-arg numeric form: floating at (x, y[, w, h])
            if (typeof a === 'number' && typeof b === 'number') {
                const hasSize = c !== undefined && d !== undefined;
                this.api.windows.open('map', {
                    kind: 'map',
                    title: 'Map',
                    autoDock: false,
                    ignoreHint: true,
                    x: Number(a),
                    y: Number(b),
                    ...(hasSize ? { width: Number(c), height: Number(d) } : {}),
                });
                return true;
            }
            // 0-arg: restore saved layout, fall back to right dock
            if (a === undefined || a === null) {
                this.api.windows.open('map', {
                    kind: 'map',
                    title: 'Map',
                    dockingArea: 'right',
                });
                return true;
            }
            // 1-arg: dockingArea string
            const area = String(a);
            if (area === 'f') {
                this.api.windows.open('map', {
                    kind: 'map',
                    title: 'Map',
                    autoDock: false,
                    ignoreHint: true,
                });
                return true;
            }
            this.api.windows.open('map', {
                kind: 'map',
                title: 'Map',
                ignoreHint: true,
                dockingArea: DOCKMAP[area] ?? 'right',
            });
            return true;
        });
        // Mudlet clearUserWindow([name]) — defaults to clearing the main
        // console when no name is given (matches `clearWindow` behaviour).
        this.lua.global.set("clearUserWindow", (window?: unknown) => {
            const name = typeof window === 'string' ? window : undefined;
            if (!name || name === 'main') this.api.clearWindow();
            else this.api.windows.clear(name);
        });
        // createMiniConsole has two calling conventions:
        //   createMiniConsole(name, x, y, w, h)              — 5 args, parent defaults to main
        //   createMiniConsole(parent, name, x, y, w, h)      — 6 args, miniconsole inside a userwindow
        // Number() coerces because regex-capture args arrive as Lua strings.
        this.lua.global.set('createMiniConsole', (a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f?: unknown) => {
            const hasParent = f !== undefined;
            const [parent, name, x, y, w, h] = hasParent
                ? [a as string, b, c, d, e, f]
                : [undefined, a, b, c, d, e];
            return this.api.createMiniConsole(
                String(name ?? ''),
                Number(x), Number(y),
                Number(w), Number(h),
                parent,
            );
        });
        // createMapper has two calling conventions:
        //   createMapper(x, y, w, h)             — 4 args, embedded in main window
        //   createMapper(parent, x, y, w, h)     — 5 args, embedded in a userwindow
        // Singleton: subsequent calls reposition the existing mapper.
        this.lua.global.set('createMapper', (a: unknown, b: unknown, c: unknown, d: unknown, e?: unknown) => {
            const hasParent = e !== undefined;
            const [parent, x, y, w, h] = hasParent
                ? [a as string, b, c, d, e]
                : [undefined, a, b, c, d];
            return this.api.createMapper(
                Number(x), Number(y),
                Number(w), Number(h),
                parent,
            );
        });
        this.lua.global.set('clearWindow',  (name?: string) => this.api.clearWindow(name));
        // hide/show/move/resize work on both labels and userwindows. Labels take
        // precedence: name uniqueness is shared across them, but createLabel can
        // race with openUserWindow under the same string.
        this.lua.global.set('hideWindow', (name: string) => {
            if (this.api.labels.has(name)) this.api.labels.hide(name);
            else this.api.windows.hide(name);
        });
        // Mudlet showWindow(name) → bool. Returns true when the named label or
        // userwindow exists and is now visible; false when nothing matches.
        this.lua.global.set('showWindow', (name: string) => {
            if (typeof name !== 'string' || !name) return false;
            if (this.api.labels.has(name)) return this.api.labels.show(name);
            return this.api.windows.show(name);
        });
        this.lua.global.set('moveWindow', (name: string, x: unknown, y: unknown) => {
            const xn = Number(x), yn = Number(y);
            if (this.api.labels.has(name)) this.api.labels.move(name, xn, yn);
            else if (this.api.windows.has(name)) this.api.windows.move(name, xn, yn);
        });
        this.lua.global.set('resizeWindow', (name: string, w: unknown, h: unknown) => {
            const wn = Number(w), hn = Number(h);
            if (this.api.labels.has(name)) this.api.labels.resize(name, wn, hn);
            else if (this.api.windows.has(name)) this.api.windows.resize(name, wn, hn);
        });
        // Mudlet setUserWindowTitle(name, [title]) → bool. Empty/missing title
        // resets to the window's id; missing window returns false.
        this.lua.global.set('setUserWindowTitle', (name: unknown, title?: unknown) => {
            if (typeof name !== 'string' || !name) return false;
            const t = title == null ? undefined : String(title);
            return this.api.windows.setTitle(name, t);
        });

        // Mudlet setBackgroundColor:
        //   setBackgroundColor(r, g, b [, a])           → main window
        //   setBackgroundColor(name, r, g, b [, a])     → named userwindow / miniconsole / label
        // Each channel is validated as a 0-255 integer (matches setFgColor /
        // setBgColor); invalid args return false without mutating state.
        // Returns true on success.
        this.lua.global.set('setBackgroundColor', (a: unknown, b: unknown, c: unknown, d?: unknown, e?: unknown) => {
            const hasName = typeof a === 'string';
            const r = channel(hasName ? b : a);
            const g = channel(hasName ? c : b);
            const bb = channel(hasName ? d : c);
            if (r === null || g === null || bb === null) return false;
            const aRaw = hasName ? e : d;
            const alpha = aRaw === undefined ? 255 : channel(aRaw);
            if (alpha === null) return false;
            return this.api.setBackgroundColor(
                hasName ? (a as string) : undefined,
                r, g, bb, alpha,
            );
        });

        // Mudlet `getBackgroundColor([name])`. Returns the rgba channels on
        // success or `(nil, errMsg)` when the named window doesn't resolve.
        // The raw entry point hands JS a 0-indexed [r, g, b, a] array, or null
        // for the miss case; Bridge.lua unpacks both into the documented
        // multi-return. The main window always resolves (defaults to
        // {0, 0, 0, 255} when no override is set).
        this.lua.global.set('__getBackgroundColor', (name?: unknown) => {
            const win = typeof name === 'string' && name && name !== 'main' ? name : undefined;
            if (win && !this.api.labels.has(win) && !this.api.windows.has(win)) {
                return null;
            }
            const c = this.api.getBackgroundColor(win) ?? { r: 0, g: 0, b: 0, a: 255 };
            return [c.r, c.g, c.b, c.a];
        });

        // Mudlet `setBackgroundImage` — overloaded across labels, miniconsoles,
        // userwindows, and the main window. The GUIUtils.lua wrapper has
        // already coerced any string mode ("center", "tile", …) into a number
        // by the time this binding fires, so the second/third arg's runtime
        // type is enough to disambiguate. All overload routing lives in
        // ScriptingAPI.setBackgroundImage — keep the binding thin so the
        // C++/Lua overload set stays in one place.
        this.lua.global.set('setBackgroundImage', (a: unknown, b?: unknown, c?: unknown) => {
            if (typeof a !== 'string') return false;
            if (b === undefined) return this.api.setBackgroundImage(a);
            if (c === undefined) {
                if (typeof b === 'number') return this.api.setBackgroundImage(a, b);
                if (typeof b === 'string') return this.api.setBackgroundImage(a, b);
                return false;
            }
            if (typeof b !== 'string') return false;
            return this.api.setBackgroundImage(a, b, Number(c));
        });

        // Mudlet `resetBackgroundImage([windowName])`. No name → main window.
        this.lua.global.set('resetBackgroundImage', (name?: unknown) => {
            return this.api.resetBackgroundImage(typeof name === 'string' ? name : undefined);
        });

        // ── Labels ────────────────────────────────────────────────────────────
        // createLabel([window,] name, x, y, w, h, fillBackground [, clickThrough]).
        // Mudlet detects the optional window arg by counting; we use the second-
        // arg type because (string,string) ⇒ window form and (string,number) ⇒
        // no window. fillBackground/clickThrough accept booleans or numbers —
        // Mudlet's own createGauge passes `1` for fillBg and the documented API
        // is "0 (transparent) or 1 (filled)", so rejecting numbers breaks
        // gauges and scripts ported from Mudlet. Anything else raises a
        // bad-argument error matching Mudlet's shape.
        const boolArg = (v: unknown, who: string, argN: number, optional: boolean): boolean => {
            if (optional && (v === undefined || v === null)) return false;
            if (typeof v === 'boolean') return v;
            if (typeof v === 'number') return v !== 0;
            throw new Error(`${who}: bad argument #${argN} type (boolean expected, got ${typeof v})`);
        };
        this.lua.global.set('createLabel', (...args: unknown[]) => {
            const hasWindow = typeof args[0] === 'string' && typeof args[1] === 'string';
            const window = hasWindow ? (args[0] as string) : 'main';
            const i = hasWindow ? 1 : 0;
            const name = args[i] as string;
            const fill = boolArg(args[i + 5], 'createLabel', hasWindow ? 7 : 6, false);
            const clickThrough = boolArg(args[i + 6], 'createLabel', hasWindow ? 8 : 7, true);
            return this.api.labels.create(name, {
                parent: window === 'main' ? 'main' : window,
                x: Number(args[i + 1]), y: Number(args[i + 2]),
                width: Number(args[i + 3]), height: Number(args[i + 4]),
                fillBackground: fill,
                clickThrough,
            });
        });
        // Mudlet deleteLabel(name) → true on success, (false, errMsg) when the
        // label doesn't exist. Bridge.lua wraps the bool into the multi-return.
        this.lua.global.set('__deleteLabel', (name: unknown) =>
            typeof name === 'string' && this.api.labels.destroy(name));
        // setLabelStyleSheet(name, css) — Qt-style CSS string, applied to the
        // label DIV. Used by Mudlet's setGaugeStyleSheet via the _back/_front/_text
        // labels.
        this.lua.global.set('setLabelStyleSheet', (name: string, css: string) => {
            this.api.labels.setStyleSheet(name, css == null ? '' : String(css));
        });
        // Mudlet's setLabelClickCallback / setLabelDoubleClickCallback /
        // setLabelReleaseCallback / setLabelMoveCallback / setLabelOnEnter /
        // setLabelOnLeave / setLabelWheelCallback all share a shape: name + a
        // Lua function (or `nil` to clear). Bridge.lua compiles the function
        // and hands JS a numeric cb id (via `__mudix_register_cb`); cb id 0
        // means "clear". We track the prior id per label-per-slot so a rebind
        // unregisters the prior chunk in `__mudix_cb` instead of leaking it.
        type LabelCbSlot = 'click' | 'doubleClick' | 'release' | 'move' | 'enter' | 'leave' | 'wheel';
        const setLabelCb = (
            name: string,
            slot: LabelCbSlot,
            cbId: number,
            install: (handler: ((event: unknown) => void) | undefined) => boolean,
        ): boolean => {
            let slots = this.labelCbIds.get(name);
            if (!slots) { slots = new Map(); this.labelCbIds.set(name, slots); }
            const prev = slots.get(slot) ?? 0;
            if (prev && prev !== cbId) this.unregisterCb(prev);
            if (!cbId) {
                slots.delete(slot);
                return install(undefined);
            }
            slots.set(slot, cbId);
            return install((event: unknown) =>
                this.dispatchCbWithArg(cbId, event, `label "${name}" ${slot}`));
        };

        this.lua.global.set('__mudix_setLabelClickCallback', (name: string, cbId: number) =>
            setLabelCb(name, 'click', cbId, fn => this.api.labels.setClickCallback(name, fn as never)));
        this.lua.global.set('__mudix_setLabelDoubleClickCallback', (name: string, cbId: number) =>
            setLabelCb(name, 'doubleClick', cbId, fn => this.api.labels.setDoubleClickCallback(name, fn as never)));
        this.lua.global.set('__mudix_setLabelReleaseCallback', (name: string, cbId: number) =>
            setLabelCb(name, 'release', cbId, fn => this.api.labels.setMouseUpCallback(name, fn as never)));
        this.lua.global.set('__mudix_setLabelMoveCallback', (name: string, cbId: number) =>
            setLabelCb(name, 'move', cbId, fn => this.api.labels.setMouseMoveCallback(name, fn as never)));
        this.lua.global.set('__mudix_setLabelOnEnter', (name: string, cbId: number) =>
            setLabelCb(name, 'enter', cbId, fn => this.api.labels.setMouseEnterCallback(name, fn as never)));
        this.lua.global.set('__mudix_setLabelOnLeave', (name: string, cbId: number) =>
            setLabelCb(name, 'leave', cbId, fn => this.api.labels.setMouseLeaveCallback(name, fn as never)));
        this.lua.global.set('__mudix_setLabelWheelCallback', (name: string, cbId: number) =>
            setLabelCb(name, 'wheel', cbId, fn => this.api.labels.setWheelCallback(name, fn as never)));
        // setLabelToolTip(name, text [, duration]) → bool. Mudlet returns false
        // when the named label doesn't exist; the duration arg is accepted for
        // compatibility but ignored — the DOM `title` attribute has no per-tip
        // duration. resetLabelToolTip clears the tooltip.
        this.lua.global.set('setLabelToolTip', (name: unknown, text?: unknown, _duration?: unknown) => {
            if (typeof name !== 'string') return false;
            return this.api.labels.setTooltip(name, text == null ? undefined : String(text));
        });
        this.lua.global.set('resetLabelToolTip', (name: unknown) => {
            if (typeof name !== 'string') return false;
            return this.api.labels.setTooltip(name, undefined);
        });
        // Runtime clickthrough toggle. Flips pointer-events live; the click
        // handler set via setLabelClickCallback stays installed either way.
        this.lua.global.set('enableClickthrough', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.setClickThrough(name, true);
        });
        this.lua.global.set('disableClickthrough', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.setClickThrough(name, false);
        });
        // Mudlet raiseWindow(name) / lowerWindow(name) — works on labels and
        // userwindows. For labels, each call bumps z past every other raised
        // label (or below every other lowered one). For userwindows, the call
        // restacks the floating window. Returns true if the target existed.
        const raiseAny = (name: unknown): boolean => {
            if (typeof name !== 'string') return false;
            if (this.api.labels.has(name)) { this.api.labels.raise(name); return true; }
            if (this.api.windows.has(name)) { this.api.windows.bringToFront(name); return true; }
            return false;
        };
        const lowerAny = (name: unknown): boolean => {
            if (typeof name !== 'string') return false;
            if (this.api.labels.has(name)) { this.api.labels.lower(name); return true; }
            if (this.api.windows.has(name)) { this.api.windows.sendToBack(name); return true; }
            return false;
        };
        this.lua.global.set('raiseWindow', raiseAny);
        this.lua.global.set('lowerWindow', lowerAny);
        // raiseLabel / lowerLabel are mudix-only legacy names. Mudlet doesn't
        // have them; ported scripts should use raiseWindow / lowerWindow. Kept
        // as aliases so existing user scripts don't break.
        this.lua.global.set('raiseLabel', raiseAny);
        this.lua.global.set('lowerLabel', lowerAny);
        // setLabelCursor(name, shape). The Mudlet GUIUtils.lua wrapper maps
        // string shape names (e.g. "PointingHand") to ints via mudlet.cursor
        // before calling here; we accept either form so the primitive works
        // even before GUIUtils.lua loads. shape -1 ('Reset') clears.
        this.lua.global.set('setLabelCursor', (name: unknown, shape: unknown) => {
            if (typeof name !== 'string') return;
            let n: number;
            if (typeof shape === 'string') {
                const lookup = QT_CURSOR_NAME_TO_INT[shape];
                if (lookup === undefined) {
                    this.api.labels.setCursor(name, undefined);
                    return;
                }
                n = lookup;
            } else {
                n = Number(shape);
            }
            if (n === -1 || Number.isNaN(n)) {
                this.api.labels.setCursor(name, undefined);
                return;
            }
            this.api.labels.setCursor(name, QT_CURSOR_TO_CSS[n] ?? 'default');
        });
        this.lua.global.set('resetLabelCursor', (name: unknown) => {
            if (typeof name === 'string') this.api.labels.setCursor(name, undefined);
        });

        // Mudlet setAppStyleSheet(css, [tag]) — install or replace a CSS block
        // in document.head, then raise sysAppStyleSheetChange so theme scripts
        // can re-apply derivative styles. The optional `tag` lets multiple
        // independent stylesheets coexist (each is keyed in `<style>`'s id).
        this.lua.global.set('setAppStyleSheet', (css: unknown, tag?: unknown) => {
            return this.api.setAppStyleSheet(
                String(css ?? ''),
                tag != null ? String(tag) : undefined,
            );
        });

        // Mudlet setUserWindowStyleSheet(name, css) — install or replace a
        // per-window CSS block. `QWidget { … }` (the canonical Mudlet selector)
        // and bare declarations auto-scope to `[data-mudix-window="name"]`, so
        // a stylesheet like `QWidget { padding: 15 20; }` actually pads the
        // panel viewport. Script authors can also write the attribute selector
        // explicitly for rules that wouldn't be a plain QWidget block.
        this.lua.global.set('setUserWindowStyleSheet', (name: unknown, css: unknown) => {
            return this.api.setUserWindowStyleSheet(String(name ?? ''), String(css ?? ''));
        });

        // No-op stubs for unimplemented label callbacks and the cmdline action
        // hook. mudlet-lua/GUIUtils.lua wraps each of these globals at load via
        // `_G[funcName] = wrapper(_G[funcName], ...)`; if the underlying global
        // is nil, the wrapper crashes with "attempt to call local 'callbackFunc'
        // (a nil value)" the first time user code calls it. Registering stubs
        // here gives the wrapper something callable so unrelated scripts load,
        // even though the callback itself does nothing yet.
        const stubWarned: Record<string, boolean> = {};
        const registerStub = (name: string) => {
            this.lua.global.set(name, () => {
                if (!stubWarned[name]) {
                    stubWarned[name] = true;
                    console.warn(`[mudix] ${name} is not yet implemented; call ignored.`);
                }
            });
        };
        // setLabelDoubleClickCallback / setLabelReleaseCallback /
        // setLabelMoveCallback / setLabelWheelCallback / setLabelOnEnter /
        // setLabelOnLeave: real bindings installed in Bridge.lua over the
        // __mudix_setLabel* primitives above.

        // Mudlet setCmdLineAction([cmdLineName,] fn, [args...]). With no
        // cmdLineName (or "main") the binding targets the single main command
        // bar; with a userwindow name it targets that window's per-window
        // command line (enabled via enableCommandLine). JS receives a numeric
        // cb id; 0 clears. Prior cb ids are freed in __mudix_cb on rebind so
        // closures don't leak.
        this.lua.global.set('__mudix_setCmdLineAction', (cbId: number, windowName?: unknown) => {
            const name = typeof windowName === 'string' && windowName && windowName !== 'main' ? windowName : null;
            if (name) {
                const prev = this.windowCmdLineActionCbIds.get(name);
                if (prev && prev !== cbId) this.unregisterCb(prev);
                if (!cbId) {
                    this.windowCmdLineActionCbIds.delete(name);
                    return this.api.windows.setCmdLineAction(name, null);
                }
                this.windowCmdLineActionCbIds.set(name, cbId);
                return this.api.windows.setCmdLineAction(name, (text: string) => {
                    this.dispatchCbWithArg(cbId, text, 'setCmdLineAction');
                });
            }
            const prev = this.cmdLineActionCbId;
            if (prev && prev !== cbId) this.unregisterCb(prev);
            this.cmdLineActionCbId = cbId || 0;
            if (!cbId) {
                this.api.setCmdLineAction(null);
                return true;
            }
            this.api.setCmdLineAction((text: string) => {
                this.dispatchCbWithArg(cbId, text, 'setCmdLineAction');
            });
            return true;
        });
        this.lua.global.set('__mudix_resetCmdLineAction', (windowName?: unknown) => {
            const name = typeof windowName === 'string' && windowName && windowName !== 'main' ? windowName : null;
            if (name) {
                const prev = this.windowCmdLineActionCbIds.get(name);
                if (prev) this.unregisterCb(prev);
                this.windowCmdLineActionCbIds.delete(name);
                return this.api.windows.setCmdLineAction(name, null);
            }
            const prev = this.cmdLineActionCbId;
            if (prev) this.unregisterCb(prev);
            this.cmdLineActionCbId = 0;
            this.api.setCmdLineAction(null);
            return true;
        });

        // ── Map view ──────────────────────────────────────────────────────────
        this.lua.global.set('centerview',      (id: number)              => this.api.centerView(id));
        // Mudlet getPlayerRoom: nil when no map / no valid room. We return
        // false because wasmoon nil round-trips through false more reliably.
        this.lua.global.set('getPlayerRoom',   ()                         => this.api.map.getPlayerRoom() ?? false);
        // Mudlet getRoomIDbyHash: returns -1 when no room has the given hash.
        this.lua.global.set('getRoomIDbyHash', (hash: string)            => this.api.getRoomIDbyHash(hash) ?? -1);
        this.lua.global.set('setRoomIDbyHash', (id: number, hash: string)=> this.api.map.setRoomIDbyHash(id, hash));
        // Mudlet getRoomHashByID: returns the hash string, or (false, errMsg) on
        // miss / when the room has no hash. JS hands back the string or null;
        // Bridge.lua unpacks the multi-return.
        this.lua.global.set('__getRoomHashByID', (id: number)            => this.api.map.getRoomHashByID(id) ?? null);

        // Mudlet loadMap([location]). With a path, reads the binary `.dat` map
        // from VFS and hands the bytes to the panel for re-render and IDB
        // persistence. Without a path the panel reloads from already-stored
        // bytes. Returns true on success, false if the file is missing,
        // unreadable, or fails to parse.
        this.lua.global.set('loadMap', (location?: unknown) => {
            if (typeof location === 'string' && location.length > 0) {
                if (!this.vfs) return false;
                let bytes: Uint8Array;
                try { bytes = this.vfs.readBinaryFile(location); }
                catch { return false; }
                return this.api.loadMap(bytes);
            }
            return this.api.loadMap();
        });

        // Mudlet saveMap([location]). Serialises the current MapStore to the
        // Mudlet binary `.dat` format and persists it to this connection's
        // IndexedDB slot. With a path, the same bytes are also written to the
        // VFS so external tools (or a future loadMap(path)) can read them
        // back. Returns true on success, false if serialisation fails or the
        // VFS write throws.
        this.lua.global.set('saveMap', (location?: unknown) => {
            const bytes = this.api.saveMap();
            if (!bytes) return false;
            if (typeof location === 'string' && location.length > 0) {
                if (!this.vfs) return false;
                try { this.vfs.writeBinaryFile(location, bytes); }
                catch { return false; }
            }
            return true;
        });

        // Mudlet saveWindowLayout / loadWindowLayout. Captures the current
        // dock layout (window positions/sizes/docking + dock-area extents) to
        // a per-connection snapshot in persistent storage; loadWindowLayout
        // restores it (re-positions live windows, opens any saved-visible
        // windows that are currently closed). Both return false on failure
        // — saveWindowLayout when there's no active connection,
        // loadWindowLayout when no snapshot exists yet.
        this.lua.global.set('saveWindowLayout', () => this.api.saveWindowLayout());
        this.lua.global.set('loadWindowLayout', () => this.api.loadWindowLayout());

        // ── Room CRUD ─────────────────────────────────────────────────────────
        // Mudlet `createRoomID([minimum])` — smallest unused room id at or
        // above `minimum`, or above the running cursor if no floor is given.
        this.lua.global.set('createRoomID', (minimum?: unknown) => {
            const m = Number(minimum);
            return this.api.map.createRoomID(Number.isFinite(m) && m > 0 ? m : undefined);
        });
        // Mudlet addRoom(roomID [, areaID]) — when an areaID is given the new
        // room is assigned to that area immediately (creating it if it doesn't
        // exist). Without one, the room lives in the default area (0) until a
        // later setRoomArea call.
        this.lua.global.set('addRoom', (id: unknown, areaId?: unknown) => {
            const rid = Number(id);
            if (!Number.isFinite(rid)) return false;
            const aid = areaId != null && areaId !== '' ? Number(areaId) : undefined;
            return this.api.map.addRoom(rid, Number.isFinite(aid as number) ? aid : undefined);
        });
        this.lua.global.set('deleteRoom',   (id: number)    => this.api.map.deleteRoom(id));
        this.lua.global.set('roomExists',   (id: number)    => this.api.map.roomExists(id));

        // ── Room properties ───────────────────────────────────────────────────
        // Mudlet getRoomName: returns the name string, or (false, errMsg) on
        // miss. JS hands back the string or null; Bridge.lua unpacks the
        // multi-return.
        this.lua.global.set('__getRoomName', (id: number)              => this.api.map.getRoomName(id) ?? null);
        this.lua.global.set('setRoomName',  (id: number, n: string)   => this.api.map.setRoomName(id, n));
        // Mudlet `getRoomArea(id)` — area id, or -1 when the room is missing.
        this.lua.global.set('getRoomArea',  (id: number)              => this.api.map.getRoomArea(Number(id)));
        // Mudlet setRoomArea(roomID|{ids}, areaID|areaName). wasmoon turns
        // Lua arrays into 0-indexed JS objects/arrays; rebuild numeric IDs
        // from either shape and forward area lookups by string or number.
        this.lua.global.set('setRoomArea', (id: unknown, a: unknown) => {
            let rooms: number | number[];
            if (Array.isArray(id)) {
                rooms = id.map(n => Number(n)).filter(n => Number.isFinite(n));
            } else if (id && typeof id === 'object') {
                const arr: number[] = [];
                const t = id as Record<string | number, unknown>;
                let i = 0;
                while (t[i] !== undefined) { arr.push(Number(t[i])); i++; }
                if (arr.length === 0) {
                    for (let k = 1; t[k] !== undefined; k++) arr.push(Number(t[k]));
                }
                rooms = arr;
            } else {
                rooms = Number(id);
            }
            const area = typeof a === 'number' ? a : (typeof a === 'string' ? a : Number(a));
            return this.api.map.setRoomArea(rooms, area);
        });
        // getRoomCoordinates returns {x,y,z} as a table; a Lua wrapper below unpacks to three values.
        this.lua.global.set('__getRoomCoordinates', (id: number)      => this.api.map.getRoomCoordinates(id));
        this.lua.global.set('setRoomCoordinates',   (id: number, x: number, y: number, z: number) => this.api.map.setRoomCoordinates(id, x, y, z));
        this.lua.global.set('getRoomsByPosition',   (areaId: number, x: number, y: number, z: number) => this.api.map.getRoomsByPosition(areaId, x, y, z));
        this.lua.global.set('getRoomEnv',   (id: number)              => this.api.map.getRoomEnv(id));
        this.lua.global.set('setRoomEnv',   (id: number, e: number)   => this.api.map.setRoomEnv(id, e));
        // Mudlet getRoomChar(id) → symbol string, or (nil, errMsg) when the
        // room doesn't exist. The raw entry point returns the empty string for
        // an unset symbol and `null` for the miss case; Bridge.lua re-shapes.
        this.lua.global.set('__getRoomChar', (id: unknown) => {
            const rid = Number(id);
            if (!Number.isFinite(rid) || !this.api.map.roomExists(rid)) return null;
            return this.api.map.getRoomChar(rid);
        });
        this.lua.global.set('setRoomChar',  (id: number, c: string)   => this.api.map.setRoomChar(id, c));
        // Mudlet `getRoomUserData(id, key [, fullErr])`. Default behaviour
        // returns the string value, or "" if either the room or key is missing.
        // With `fullErr=true` Mudlet differentiates the miss cases: returns
        // (false, errMsg). The raw entry point reports which case applied so
        // the Bridge.lua wrapper can shape the multi-return.
        this.lua.global.set('__getRoomUserData', (id: unknown, k: unknown) => {
            const rid = Number(id);
            const key = String(k ?? '');
            if (!Number.isFinite(rid) || !this.api.map.roomExists(rid)) {
                return { miss: 'room', id: rid };
            }
            const v = this.api.map.getRoomUserData(rid, key);
            return v === undefined ? { miss: 'key', key } : { value: v };
        });
        this.lua.global.set('setRoomUserData', (id: number, k: string, v: string)=> this.api.map.setRoomUserData(id, k, v));
        // Mudlet `getRoomUserDataKeys(id)` → sequential table of keys, or nil
        // when the room doesn't exist. JS hands back an array (wasmoon 0-indexed
        // on the Lua side) or `null` for the miss; Bridge.lua re-indexes to a
        // 1-indexed Lua table.
        this.lua.global.set('__getRoomUserDataKeys', (id: unknown) => {
            const rid = Number(id);
            if (!Number.isFinite(rid)) return null;
            return this.api.map.getRoomUserDataKeys(rid) ?? null;
        });

        // ── Map-level user data ───────────────────────────────────────────────
        // Mudlet getMapUserData(key) / setMapUserData(key, value) /
        // clearMapUserData() / clearMapUserDataItem(key) operate on
        // MapStore.mapUserData and serialize into MudletMap.mUserData when
        // toMudletMap() runs; loaded maps push their mUserData in via
        // MapPanel.loadFromBuffer → MapStore.loadMapUserData.
        // Mudlet getMapUserData(key) → value on success, (false, errMsg) when
        // the key is not present. The raw entry point hands JS `null` for the
        // miss case; Bridge.lua re-shapes it into the documented multi-return.
        this.lua.global.set('__getMapUserData', (k: unknown) => {
            const v = this.api.map.getMapUserData(String(k ?? ''));
            return v === undefined ? null : v;
        });
        this.lua.global.set('setMapUserData',    (k: unknown, v: unknown) => {
            this.api.map.setMapUserData(String(k ?? ''), String(v ?? ''));
            return true;
        });
        // Mudlet split: clearMapUserData() wipes the whole dict;
        // clearMapUserDataItem(key) drops a single key.
        this.lua.global.set('clearMapUserData',     ()              => this.api.map.clearMapUserData());
        this.lua.global.set('clearMapUserDataItem', (k: unknown)    => this.api.map.clearMapUserDataItem(String(k ?? '')));
        this.lua.global.set('getAllMapUserData', () => this.api.map.getAllMapUserData());

        // ── Exits ─────────────────────────────────────────────────────────────
        // Mudlet's setExit/setExitStub accept the direction either as the
        // numeric 1-12 index or as a name ("north"/"n"/etc.); MapStore's
        // parseDirection normalizes both forms.
        this.lua.global.set('getRoomExits',      (id: number)                          => this.api.map.getRoomExits(id));
        this.lua.global.set('setExit', (from: unknown, to: unknown, dir: unknown) =>
            this.api.map.setExit(Number(from), Number(to), dir as number | string));
        this.lua.global.set('getExitStubs',      (id: number)                          => this.api.map.getExitStubs(id));
        this.lua.global.set('setExitStub', (id: unknown, dir: unknown, set: unknown) =>
            this.api.map.setExitStub(Number(id), dir as number | string, !!set));
        this.lua.global.set('addSpecialExit',    (from: number, to: number, cmd: string)=> this.api.map.addSpecialExit(from, to, cmd));
        this.lua.global.set('removeSpecialExit', (from: number, cmd: string)            => this.api.map.removeSpecialExit(from, cmd));
        this.lua.global.set('getSpecialExitsSwap',(id: number)                         => this.api.map.getSpecialExitsSwap(id));
        // Mudlet `getCustomLines(roomID)` → { [dir] = { attributes={color,style,arrow}, points=[{x,y,z},...] } }.
        // Returns nil when the room doesn't exist; wasmoon converts the JS
        // arrays/objects directly — the `points` array lands 0-indexed on the
        // Lua side, matching Mudlet's documented shape.
        this.lua.global.set('getCustomLines', (id: unknown) => {
            const rid = Number(id);
            if (!Number.isFinite(rid)) return null;
            return this.api.map.getCustomLines(rid) ?? null;
        });

        // ── Doors ─────────────────────────────────────────────────────────────
        // setDoor's direction can be a stock direction (numeric or name) or
        // an arbitrary special-exit command string.
        this.lua.global.set('getDoors', (id: number)                      => this.api.map.getDoors(id));
        this.lua.global.set('setDoor', (id: unknown, dir: unknown, val: unknown) =>
            this.api.map.setDoor(Number(id), dir as number | string, Number(val)));

        // ── Map context-menu events ───────────────────────────────────────────
        // Mudlet addMapEvent(uniqueName, eventName [, parent [, displayName [, ...args]]]).
        // Right-click on a room → context menu of registered entries; clicking one
        // fires raiseEvent(eventName, uniqueName, roomId) — matching Mudlet's
        // T2DMap::slot_userAction selection branch. mudix treats the right-clicked
        // room as the selection (we don't have multi-select); the extra args
        // registered with addMapEvent are dropped, same as Mudlet does here.
        this.api.map.setMapEventDispatcher((event, args) => this.emitEvent(event, args));
        // Mudlet add/removeMapEvent don't return anything (mutating registry
        // primitives). We drop the JS bool result so Lua callers can't pattern
        // on a non-canonical extra return.
        this.lua.global.set('addMapEvent', (
            uniqueName: unknown, eventName: unknown,
            parent?: unknown, displayName?: unknown, ...args: unknown[]
        ) => {
            this.api.map.addMapEvent(
                String(uniqueName ?? ''),
                String(eventName ?? ''),
                parent == null ? null : String(parent),
                displayName == null ? null : String(displayName),
                ...args,
            );
        });
        this.lua.global.set('removeMapEvent', (uniqueName: unknown) => {
            this.api.map.removeMapEvent(String(uniqueName ?? ''));
        });
        // Mudlet shape:
        //   { [uniqueName] = {
        //         ["event name"]   = "...",
        //         ["parent"]       = "...",
        //         ["display name"] = "...",
        //         ["arguments"]    = { ... },  -- 1-indexed extra args
        //   } }
        // Build the per-entry table on the Lua side via doString so the keys
        // land as proper Lua strings and the args table is 1-indexed (wasmoon
        // would otherwise key a JS array 0..n-1).
        this.lua.global.set('__getMapEvents', () => this.api.map.getMapEvents());

        // ── Custom env colors ─────────────────────────────────────────────────
        // Mudlet setCustomEnvColor(envID, r, g, b, a). Updates mCustomEnvColors
        // on the active map; the renderer reads this when painting rooms whose
        // environment matches envID. Channels are validated as 0..255 ints via
        // the shared `channel()` helper; invalid args silently no-op.
        this.lua.global.set('setCustomEnvColor', (envId: unknown, r: unknown, g: unknown, b: unknown, a?: unknown) => {
            const eid = Number(envId);
            if (!Number.isFinite(eid)) return;
            const rr = channel(r);
            const gg = channel(g);
            const bb = channel(b);
            if (rr === null || gg === null || bb === null) return;
            const alpha = a === undefined ? 255 : channel(a);
            if (alpha === null) return;
            this.api.map.setCustomEnvColor(Math.trunc(eid), rr, gg, bb, alpha);
        });
        // getCustomEnvColor(envID) → r, g, b, a (4 return values), or nil if
        // the envID has no override. The Lua wrapper unpacks the JS array.
        this.lua.global.set('__getCustomEnvColor', (envId: unknown) => {
            const c = this.api.map.getCustomEnvColor(Number(envId));
            return c ? [c.r, c.g, c.b, c.a] : null;
        });
        // Mudlet getCustomEnvColorTable() → { [envID] = {r, g, b, a} } with
        // 1-indexed inner arrays. The raw JS bridge returns plain objects; the
        // Bridge.lua wrapper rebuilds the inner tables 1-indexed and re-keys by
        // numeric envID.
        this.lua.global.set('__getCustomEnvColorTable',
            () => this.api.map.getCustomEnvColorTable());

        // ── Areas ─────────────────────────────────────────────────────────────
        // Mudlet addAreaName / setAreaName return (false, errMsg) on duplicate
        // or empty inputs; MapStore packs failures as { ok:false, err } and a
        // Bridge.lua wrapper turns those into a Lua multi-return.
        this.lua.global.set('__addAreaName', (name: unknown) => {
            const r = this.api.map.addAreaName(String(name ?? ''));
            if (typeof r === 'number') return r;
            return { ok: false, err: r.err };
        });
        // deleteArea(areaID|areaName) — accept either form.
        this.lua.global.set('deleteArea', (idOrName: unknown) =>
            this.api.map.deleteArea(idOrName as number | string));
        this.lua.global.set('getAreaTable',   ()                        => this.api.map.getAreaTable());
        // getRoomAreaName is bidirectional: number → name string, name → number.
        // Returns false when the input cannot be resolved (matches the
        // existing convention; Mudlet returns nil/false on miss).
        this.lua.global.set('getRoomAreaName', (idOrName: unknown) => {
            const v = this.api.map.getRoomAreaName(idOrName as number | string);
            return v ?? false;
        });
        this.lua.global.set('__setAreaName', (idOrName: unknown, n: unknown) => {
            const r = this.api.map.setAreaName(idOrName as number | string, String(n ?? ''));
            if (r === true) return true;
            return { ok: false, err: typeof r === 'object' ? r.err : 'setAreaName: failed' };
        });
        this.lua.global.set('getAreaRooms',   (areaId: number)          => this.api.map.getAreaRooms(areaId));
        this.lua.global.set('getRooms',       ()                        => this.api.map.getRooms());
        // Mudlet getMapLabels(areaID) → { [labelID] = labelText }. Bridge.lua
        // re-keys via tonumber since wasmoon hands object keys across as
        // numeric strings; Mudlet scripts expect to index by integer label id.
        this.lua.global.set('__getMapLabels', (areaId: unknown) =>
            this.api.map.getMapLabels(Number(areaId)));
        // Mudlet getMapLabel(areaID, labelID|labelText) — overloaded by arg-2
        // type. JS returns a discriminated result ({ok:false,err}/{ok:true,single|multi});
        // Bridge.lua rebuilds the final shape — flat properties for the by-id
        // form, {[id]=props,...} for by-text — and translates errors into
        // Mudlet's (false, errMsg) multi-return.
        this.lua.global.set('__getMapLabel', (areaId: unknown, key: unknown) =>
            this.api.map.getMapLabel(Number(areaId), typeof key === 'number' ? key : String(key ?? '')));

        // ── Output / format ───────────────────────────────────────────────────
        this.lua.global.set('fg',          (name: string)  => this.api.fg(name));
        this.lua.global.set('bg',          (name: string)  => this.api.bg(name));
        // insertText([window,] text). Mudlet's xEcho passes (win, segment) into
        // _G["insertText"] for cinsertText/creplace/prefix; without the window
        // overload the window name lands in the text slot and the actual segment
        // is dropped, producing a wall of "main"s. The API itself decides where
        // to write (lineBuffer at cursor inside triggers, echo otherwise).
        this.lua.global.set('insertText', (a: string, b?: string) => {
            if (b !== undefined) this.api.insertText(b, a);
            else                 this.api.insertText(a);
        });
        this.lua.global.set('feedTriggers',(text: string)  => this.api.feedTriggers(text));
        this.lua.global.set('deleteLine',  (win?: string)  => this.api.deleteLine(win));
        // Mudlet `printError(msg, [showStackTrace], [haltExecution])`. mudix
        // routes every script-emitted error through the same logging path so
        // there's no JS-level stack to render; we accept the optional flags for
        // signature parity and honour `haltExecution=true` by raising a Lua
        // error so the calling script aborts (Mudlet's behaviour).
        this.lua.global.set('printError', (text: unknown, _showStack?: unknown, haltExec?: unknown) => {
            this.api.printError(String(text ?? ''));
            if (haltExec) {
                throw new Error(typeof text === 'string' ? text : String(text));
            }
        });
        // echoLink primitive — always string cmd. Function-cmd conversion is done
        // by the Lua wrapper installed later in the doString block.
        this.lua.global.set('echoLink', (a: unknown, b: unknown, c: unknown, d?: unknown, e?: unknown) => {
            // Calling conventions (Mudlet-compatible):
            //   echoLink(text, cmd, tooltip [, useCurrentFormat])           — 3-4 args, no window
            //   echoLink(window, text, cmd, tooltip [, useCurrentFormat])   — 4-5 args, with window
            // Distinguish by typeof d: 'string' = tooltip (window form), 'boolean'|undefined = useCurrentFormat
            const hasWindow = typeof d === 'string';
            const win = hasWindow ? (a as string) : undefined;
            const text = hasWindow ? (b as string) : (a as string);
            const cmd = hasWindow ? (c as string) : (b as string);
            const tooltip = hasWindow ? (d as string) : (c as string);
            const useCurrentFormat = !!(hasWindow ? e : d);
            this.api.echoLink(text, cmd, tooltip, win, useCurrentFormat);
        });

        // insertLink primitive — same overload set as echoLink, but inserts at the
        // cursor on the current line instead of echoing to the end of the buffer.
        // Lua-side `cinsertLink`/`dinsertLink`/`hinsertLink` (in mudlet-lua/GUIUtils)
        // route here via xEcho.
        this.lua.global.set('insertLink', (a: unknown, b: unknown, c: unknown, d?: unknown, e?: unknown) => {
            const hasWindow = typeof d === 'string';
            const win = hasWindow ? (a as string) : undefined;
            const text = hasWindow ? (b as string) : (a as string);
            const cmd = hasWindow ? (c as string) : (b as string);
            const tooltip = hasWindow ? (d as string) : (c as string);
            const useCurrentFormat = !!(hasWindow ? e : d);
            this.api.insertLink(text, cmd, tooltip, win, useCurrentFormat);
        });

        // Mudlet `setLink([window,] cmd, hint)` — applies the link to the current
        // selection. Function-cmd conversion is done in Bridge.lua (same pattern
        // as echoLink). Disambiguate by argc: 3 strings → with-window, 2 → main.
        this.lua.global.set('setLink', (a: unknown, b: unknown, c?: unknown) => {
            const hasWindow = typeof c === 'string';
            const win = hasWindow ? (a as string) : undefined;
            const cmd = hasWindow ? (b as string) : (a as string);
            const hint = hasWindow ? (c as string) : (b as string);
            return this.api.setLink(cmd ?? '', hint ?? '', win);
        });

        // Lua wrapper converts cmds/hints tables to \x01-delimited strings before calling here.
        // xEcho always passes (win, text, cmds_str, hints_str, fmt); win defaults to "main".
        this.lua.global.set('echoPopup', (win: unknown, text: unknown, cmds: unknown, hints: unknown, _fmt?: unknown) => {
            const textStr = text as string;
            if (!textStr) return;
            const split = (s: unknown) => s ? String(s).split('\x01').filter(Boolean) : [];
            const cmdsArr = split(cmds);
            const hintsArr = split(hints);
            const winStr = (win && win !== 'main') ? win as string : undefined;
            this.api.echoPopup(textStr, cmdsArr, hintsArr, winStr);
        });

        // Mudlet `openWebPage(url) → bool`. Opens the URL in the user's
        // default browser; returns false when the popup is blocked or the URL
        // is empty.
        this.lua.global.set('openWebPage', (url: unknown) => {
            const u = typeof url === 'string' ? url.trim() : '';
            if (!u) return false;
            const w = window.open(u, '_blank');
            return !!w;
        });

        // Mudlet `openUrl(url)`. Like openWebPage for http(s) URLs, but a
        // `file:` prefix routes to the VFS file browser — that's how Mudlet
        // scripts expose VFS paths to the user (`openUrl("file:" .. getMudletHomeDir())`).
        this.lua.global.set('openUrl', (url: unknown) => {
            return this.api.openUrl(typeof url === 'string' ? url : '');
        });

        // ── Send ─────────────────────────────────────────────────────────────
        // Mudlet `send(text, [echo=true]) → true`. Echo defaults to true.
        this.lua.global.set('send', (text: unknown, echo?: unknown) => {
            this.api.send(String(text ?? ''), echo == null ? true : !!echo);
            return true;
        });
        // Mudlet `sendGMCP(message, [what])`: the caller passes a single string
        // body (e.g. `Core.Supports.Add ["Char 1"]`), framed by IAC SB GMCP …
        // IAC SE. The optional second `what` arg is concatenated with a space
        // separator (Mudlet behaviour) so scripts can pass the package name
        // and payload separately.
        this.lua.global.set('sendGMCP', (message: unknown, what?: unknown) => {
            const body = String(message ?? '');
            const tail = what != null ? ' ' + String(what) : '';
            this.api.sendGmcp(body + tail);
        });
        // Cancels the in-flight sysDataSendRequest dispatch. Only meaningful while
        // a sysDataSendRequest handler is on the stack — flag is reset before each send.
        this.lua.global.set('denyCurrentSend', () => { this._denyCurrentSend = true; });

        // ── Command bar ───────────────────────────────────────────────────────
        // Mudlet's cmdline APIs accept an optional first window-name arg for
        // sub-command-lines (Geyser.CommandLine / userwindow command lines).
        // We route to the per-window command line when a matching userwindow
        // is open with enableCommandLine; otherwise we drop the name and
        // target the main command bar.
        const isUserCmdLine = (name?: unknown): name is string => {
            if (typeof name !== 'string' || !name || name === 'main') return false;
            return this.api.windows.has(name);
        };
        this.lua.global.set('appendCmdLine', (a: unknown, b?: unknown) => {
            if (isUserCmdLine(a)) { this.api.windows.appendCmdLine(a, String(b ?? '')); return; }
            this.api.appendCmdLine(String(b !== undefined ? b : a));
        });
        this.lua.global.set('printCmdLine', (a: unknown, b?: unknown) => {
            if (isUserCmdLine(a)) { this.api.windows.printCmdLine(a, String(b ?? '')); return; }
            this.api.printCmdLine(String(b !== undefined ? b : a));
        });
        this.lua.global.set('clearCmdLine', (name?: unknown) => {
            if (isUserCmdLine(name)) { this.api.windows.clearCmdLine(name); return; }
            this.api.clearCmdLine();
        });
        // Mudlet getCmdLine([name]) → current input string. Returns the live
        // value of the named userwindow's command line when present, else the
        // main command bar.
        this.lua.global.set('getCmdLine', (name?: unknown) => {
            if (isUserCmdLine(name)) return this.api.windows.getCmdLineValue(name);
            return this.api.getCmdLine();
        });
        // Mudlet enableCommandLine / disableCommandLine for userwindows. mudix
        // doesn't (yet) gate the main cmd bar this way — calling with no name
        // or "main" is a no-op that returns true so scripts targeting the main
        // bar don't crash.
        this.lua.global.set('enableCommandLine', (name?: unknown) => {
            if (typeof name !== 'string' || !name || name === 'main') return true;
            return this.api.windows.enableCommandLine(name);
        });
        this.lua.global.set('disableCommandLine', (name?: unknown) => {
            if (typeof name !== 'string' || !name || name === 'main') return true;
            return this.api.windows.disableCommandLine(name);
        });
        // Mudlet setCmdLineStyleSheet(name, css). mudix has no main-bar QSS
        // hook, so the main / "main" form is a no-op that returns true.
        this.lua.global.set('setCmdLineStyleSheet', (a: unknown, b?: unknown) => {
            const name = typeof a === 'string' ? a : '';
            const css = String((b !== undefined ? b : (typeof a === 'string' && b === undefined ? '' : a)) ?? '');
            if (!name || name === 'main') return true;
            return this.api.windows.setCmdLineStyleSheet(name, css);
        });
        // Mudlet (add|remove)CmdLineSuggestion([name], suggestion) /
        // clearCmdLineSuggestions([name]). Suggestions feed Tab completion in
        // the command bar (merged with command history). The optional leading
        // command-line name arg is accepted for parity and dropped.
        const cmdLineSuggestArg = (a: unknown, b?: unknown): string => {
            const v = b !== undefined ? b : a;
            return String(v ?? '');
        };
        this.lua.global.set('addCmdLineSuggestion', (a: unknown, b?: unknown) => {
            this.api.addCmdLineSuggestion(cmdLineSuggestArg(a, b));
        });
        this.lua.global.set('removeCmdLineSuggestion', (a: unknown, b?: unknown) => {
            this.api.removeCmdLineSuggestion(cmdLineSuggestArg(a, b));
        });
        this.lua.global.set('clearCmdLineSuggestions', (_name?: string) => {
            this.api.clearCmdLineSuggestions();
        });

        // ── Command-line context menu ─────────────────────────────────────────
        // Mudlet addCommandLineMenuEvent([cmdLineName,] menuLabel, eventName).
        // The menuLabel is both the unique key and the display string — there
        // is no separate displayName arg. We support the single command bar
        // and ignore the optional cmdLineName arg.
        this.api.cmdLineMenu.setDispatcher((event, args) => this.emitEvent(event, args));
        this.lua.global.set('addCommandLineMenuEvent', (
            a: unknown, b: unknown, c?: unknown,
        ) => {
            // 2 args: (menuLabel, eventName).
            // 3 args: (cmdLineName, menuLabel, eventName) — drop cmdLineName.
            let menuLabel: unknown, eventName: unknown;
            if (c !== undefined) {
                menuLabel = b; eventName = c;
            } else {
                menuLabel = a; eventName = b;
            }
            return this.api.cmdLineMenu.add(
                String(menuLabel ?? ''),
                String(eventName ?? ''),
            );
        });
        // Mudlet removeCommandLineMenuEvent(uniqueName) → true on success, or
        // (false, errMsg) when the entry doesn't exist. The optional leading
        // cmdLineName arg is accepted for parity and ignored.
        this.lua.global.set('__removeCommandLineMenuEvent', (a: unknown, b?: unknown) => {
            const uniqueName = b !== undefined ? b : a;
            return this.api.cmdLineMenu.remove(String(uniqueName ?? ''));
        });
        // Mudlet shape: { [uniqueName] = { event, display } }
        this.lua.global.set('getCommandLineMenuEvents', () => {
            const out: Record<string, unknown> = {};
            for (const e of this.api.cmdLineMenu.list()) {
                out[e.uniqueName] = { event: e.eventName, display: e.displayName };
            }
            return out;
        });

        // ── Packages ──────────────────────────────────────────────────────────
        // Mudlet's installPackage takes a filesystem path; an override in
        // Other.lua wraps this to also accept http(s):// URLs by routing
        // through downloadFile + sysDownloadDone. Our impl reads the path
        // from the profile VFS, commits the parsed nodes to the store, and
        // raises sysInstall(Package).
        this.lua.global.set('installPackage', (path: string) => this.api.installPackage(String(path ?? '')));
        // Mudlet `uninstallPackage(name)` → true on success, nil when no package
        // with that name is installed.
        this.lua.global.set('uninstallPackage', (name: string) => {
            return this.api.uninstallPackage(String(name ?? '')) ? true : null;
        });
        // Mudlet getPackages() — list of installed package names. JS arrays land
        // in Lua 0-indexed via wasmoon, so a Bridge.lua wrapper rebuilds it to a
        // 1-indexed sequence.
        this.lua.global.set('__getPackages', () => this.api.getPackages());

        // ── Modules ───────────────────────────────────────────────────────────
        // Mudlet's module APIs are the package APIs' siblings: installModule
        // takes a VFS path, modules persist their XML on disk, and uninstall
        // unlinks rather than deleting source files. Negative priorities load
        // before profile scripts; non-negative load after.
        //
        // Mudlet `installModule(path)` → true on success. The path argument is
        // accepted; failures log to printError and report false.
        this.lua.global.set('installModule', (path: unknown) =>
            this.api.installModule(String(path ?? '')));
        this.lua.global.set('uninstallModule', (name: unknown) =>
            this.api.uninstallModule(String(name ?? '')));
        // Mudlet `reloadModule(name)` doesn't return anything; we still flag
        // failures via the printError call inside ScriptingEngine.
        this.lua.global.set('reloadModule', (name: unknown) => {
            this.api.reloadModule(String(name ?? ''));
        });
        this.lua.global.set('__mudix_syncModule', (name: unknown) => {
            // Fire-and-forget; Lua callers don't get a promise. The underlying
            // flush is async but the in-app effect (sysSyncOnModule) will fire
            // on success.
            void this.api.syncModule(String(name ?? '')).catch(() => {});
        });
        // Mudlet `enableModuleSync(name)` / `disableModuleSync(name)` → true on
        // success, (nil, errMsg) when the name isn't an installed module.
        const requireModule = (name: string, who: string): void => {
            const info = this.api.getModuleInfo(name);
            if (!info) throw new Error(`${who}: "${name}" is not an installed module`);
        };
        this.lua.global.set('enableModuleSync', (name: unknown) => {
            const n = String(name ?? '');
            requireModule(n, 'enableModuleSync');
            this.api.enableModuleSync(n);
            return true;
        });
        this.lua.global.set('disableModuleSync', (name: unknown) => {
            const n = String(name ?? '');
            requireModule(n, 'disableModuleSync');
            this.api.disableModuleSync(n);
            return true;
        });
        // Mudlet `getModuleSync(name)` → bool. Unknown modules raise.
        this.lua.global.set('getModuleSync', (name: unknown) => {
            const n = String(name ?? '');
            requireModule(n, 'getModuleSync');
            return this.api.getModuleSync(n);
        });
        // Mudlet setModulePriority / getModulePriority both raise on unknown
        // module name — quiet defaults would mask typos.
        this.lua.global.set('setModulePriority', (name: unknown, priority: unknown) => {
            const n = String(name ?? '');
            requireModule(n, 'setModulePriority');
            const p = Math.trunc(Number(priority ?? 0));
            this.api.setModulePriority(n, Number.isFinite(p) ? p : 0);
            return true;
        });
        this.lua.global.set('getModulePriority', (name: unknown) => {
            const n = String(name ?? '');
            requireModule(n, 'getModulePriority');
            return this.api.getModulePriority(n);
        });
        this.lua.global.set('__getModules', () => this.api.getModules());
        // Mudlet getModuleInfo(name [, key]). The Bridge.lua wrapper handles the
        // optional `key` projection; here we just return the manifest table or
        // `nil` when no module by that name exists.
        this.lua.global.set('__getModuleInfo', (name: unknown) =>
            this.api.getModuleInfo(String(name ?? '')));

        // ── Script enable/disable ─────────────────────────────────────────────
        // Mudlet looks scripts up by name; toggling the flag cascades the
        // store subscription which loads/unloads Lua handlers synchronously.
        // Mudlet `enableScript(name)` / `disableScript(name)` raise on miss
        // instead of silently returning false — scripts that depend on a
        // particular package being present prefer the loud failure.
        this.lua.global.set('enableScript', (name: unknown) => {
            const n = String(name ?? '');
            if (!this.api.enableScript(n)) {
                throw new Error(`enableScript: no script named "${n}"`);
            }
            return true;
        });
        this.lua.global.set('disableScript', (name: unknown) => {
            const n = String(name ?? '');
            if (!this.api.disableScript(n)) {
                throw new Error(`disableScript: no script named "${n}"`);
            }
            return true;
        });
        // Mudlet permScript(name, parent, luaCode) — creates a persisted script
        // under an existing script group (parent="" → root). Returns the new
        // script's id (UUID string) or -1 on failure. The Bridge.lua wrapper
        // coerces nil args before calling.
        this.lua.global.set('__mudix_permScript', (name: unknown, parent: unknown, code: unknown) =>
            this.api.permScript(String(name ?? ''), String(parent ?? ''), String(code ?? '')));
        // Mudlet permRegexTrigger(name, parent, regexes, luaCode). The Bridge.lua
        // wrapper flattens the regex table to a \x01-delimited string (wasmoon's
        // JS proxy for Lua tables doesn't iterate reliably from JS); we split it
        // back here. An empty regexes string means "create a group".
        this.lua.global.set('__mudix_permRegexTrigger', (name: unknown, parent: unknown, regexesStr: unknown, code: unknown) => {
            const s = String(regexesStr ?? '');
            const regexes = s.length === 0 ? [] : s.split('\x01');
            return this.api.permRegexTrigger(String(name ?? ''), String(parent ?? ''), regexes, String(code ?? ''));
        });
        // Mudlet setScript(name, luaCode[, pos]) — replace the source of an
        // existing script. pos is 1-indexed; missing/non-numeric falls back to
        // 1. Returns true or -1.
        this.lua.global.set('setScript', (name: unknown, code: unknown, pos?: unknown) => {
            const n = typeof pos === 'number' && Number.isFinite(pos) ? pos : 1;
            return this.api.setScript(String(name ?? ''), String(code ?? ''), n);
        });
        this.lua.global.set('enableTrigger', (name: string) => this.api.enableTrigger(String(name ?? '')));
        this.lua.global.set('disableTrigger', (name: string) => this.api.disableTrigger(String(name ?? '')));
        this.lua.global.set('enableTimer', (name: string) => this.api.enableTimer(String(name ?? '')));
        this.lua.global.set('disableTimer', (name: string) => this.api.disableTimer(String(name ?? '')));
        this.lua.global.set('enableAlias', (name: string) => this.api.enableAlias(String(name ?? '')));
        this.lua.global.set('disableAlias', (name: string) => this.api.disableAlias(String(name ?? '')));

        // Mudlet `exists(nameOrId, type)`. With a string, returns the count of
        // items matching the name; with a number, returns 1 if a perm item
        // with that monotonic id lives in the named collection (else 0).
        // Type strings: "alias", "trigger", "timer", "key"/"keybind",
        // "button", "script". Unknown types return 0.
        this.lua.global.set('exists', (nameOrId: unknown, type: unknown) => {
            const key = typeof nameOrId === 'number'
                ? nameOrId
                : String(nameOrId ?? '');
            return this.api.exists(key, String(type ?? ''));
        });

        // ── Async unzip ───────────────────────────────────────────────────────
        // Mudlet's unzipAsync is fire-and-forget: returns immediately, raises
        // sysUnzipDone(zipPath, destDir) on success or
        // sysUnzipError(zipPath, destDir) on failure. fflate's unzip uses Web
        // Workers internally on platforms that support them, falling back to
        // a chunked main-thread decode otherwise.
        this.lua.global.set('unzipAsync', (zipPath: string, destDir: string) => {
            this.runUnzipAsync(String(zipPath ?? ''), String(destDir ?? ''));
        });

        // ── File watches ──────────────────────────────────────────────────────
        // Mudlet addFileWatch(path)/removeFileWatch(path). Watches are matched
        // by resolved absolute path; the VFS mutation hooks above fire
        // sysPathChanged(path) when a watched file or any descendant of a
        // watched directory changes.
        this.lua.global.set('addFileWatch', (path: unknown): boolean => {
            const vfs = this.vfs;
            if (!vfs || typeof path !== 'string' || !path) return false;
            if (!vfs.exists(path)) return false;
            this.watchedPaths.add(vfs.resolvePath(path));
            return true;
        });

        this.lua.global.set('removeFileWatch', (path: unknown): boolean => {
            const vfs = this.vfs;
            if (!vfs || typeof path !== 'string' || !path) return false;
            return this.watchedPaths.delete(vfs.resolvePath(path));
        });

        // Mudlet saveProfile([location]). zustand state (scripts/aliases/etc.)
        // already auto-syncs to localStorage on every mutation; the work this
        // call adds is forcing pending VFS writes through to IndexedDB / the
        // linked folder. Synchronously snapshots any debounced SQL writes,
        // then kicks off vfs.flush() in the background. Returns the profile
        // path immediately so the Lua wrapper below can shape it as
        // (true, path). The optional `location` arg is accepted for
        // compatibility but ignored — there is no alternate save target.
        // Returns an [ok, path|errMsg] tuple synchronously. Async flush errors
        // can't be reported through the return — they raise `sysSaveProfileError`
        // (eventName, profilePath, errMsg) so user code can subscribe.
        this.lua.global.set('__mudix_saveProfile', (_location?: unknown): [boolean, string] => {
            this.flushPendingSqlSnapshots();
            const vfs = this.vfs;
            if (!vfs) return [false, 'saveProfile: no profile VFS available'];
            const path = vfs.profilePath ?? '';
            vfs.flush().catch(err => {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[saveProfile] vfs flush failed:', err);
                this.emitEvent('sysSaveProfileError', [path, msg]);
            });
            return [true, path];
        });

        // ── Line / cursor inspection ──────────────────────────────────────────
        // Mudlet `isPrompt([window])` — reports the per-line prompt flag for
        // the line at the current cursor position. ScriptingAPI tags the buffer
        // when beginLine() runs the trigger pass, so historical lines remain
        // queryable via moveCursor + isPrompt (not just the most recent line).
        this.lua.global.set('isPrompt', (win?: unknown) =>
            this.api.isPrompt(typeof win === 'string' ? win : undefined));
        // Mudlet `getCurrentLine([window])` → line text, or `(nil, errMsg)` for
        // a non-existent named window. The raw entry point hands JS `null` for
        // the miss case; Bridge.lua re-shapes it into the documented multi-return.
        this.lua.global.set('__getCurrentLine', (win?: string) => this.api.getCurrentLine(win));
        this.lua.global.set('getLineNumber',  (win?: string)=> this.api.getLineNumber(win));
        this.lua.global.set('getLineCount',   (win?: string)=> this.api.getLineCount(win));
        this.lua.global.set('getLastLineNumber', (win?: string)=> this.api.getLastLineNumber(win));
        // Mudlet [enable|disable][Horizontal]ScrollBar([windowName])
        const scrollWin = (win?: unknown) => typeof win === 'string' ? win : undefined;
        this.lua.global.set('disableScrollBar',           (win?: unknown) => this.api.disableScrollBar(scrollWin(win)));
        this.lua.global.set('enableScrollBar',            (win?: unknown) => this.api.enableScrollBar(scrollWin(win)));
        this.lua.global.set('disableHorizontalScrollBar', (win?: unknown) => this.api.disableHorizontalScrollBar(scrollWin(win)));
        this.lua.global.set('enableHorizontalScrollBar',  (win?: unknown) => this.api.enableHorizontalScrollBar(scrollWin(win)));
        this.lua.global.set('disableScrolling',           (win?: unknown) => this.api.disableScrolling(scrollWin(win)));
        this.lua.global.set('enableScrolling',            (win?: unknown) => this.api.enableScrolling(scrollWin(win)));
        // Mudlet getScroll([windowName]) — buffer line index at viewport top.
        this.lua.global.set('getScroll', (win?: unknown) => this.api.getScroll(scrollWin(win)));
        // Mudlet scrollTo([windowName,] [lineNumber]). With no line (or no args)
        // resume tail mode. Wasmoon hands regex captures as strings, so the
        // numeric branch wraps with Number().
        this.lua.global.set('scrollTo', (a?: unknown, b?: unknown) => {
            if (typeof a === 'string') {
                return this.api.scrollTo(a, b === undefined ? undefined : Number(b));
            }
            if (a === undefined) return this.api.scrollTo(undefined, undefined);
            return this.api.scrollTo(undefined, Number(a));
        });
        this.lua.global.set('getColumnNumber',(win?: string)=> this.api.getColumnNumber(win));
        this.lua.global.set('getColumnCount', (win?: string)=> this.api.getColumnCount(win));
        // setWindowWrap(windowName, charsPerLine) — Mudlet shape. The name arg
        // is required; non-string raises a bad-argument error so scripts that
        // forgot the name (the no-arg "shorthand") see the same failure they
        // would in Mudlet.
        this.lua.global.set('setWindowWrap', (a: unknown, b?: unknown) => {
            if (typeof a !== 'string') {
                throw new Error('setWindowWrap: bad argument #1 type (window name as string expected, got ' + typeof a + ')');
            }
            return this.api.setWindowWrap(a, Number(b));
        });
        // getLines([window,] from, to) — JS array crosses wasmoon as a
        // 0-indexed Lua table; the Bridge.lua wrapper rebuilds it as a
        // 1-indexed sequence so `ipairs` works as Mudlet scripts expect.
        this.lua.global.set('__getLines', (a: string | number, b: number, c?: number) => {
            return c !== undefined
                ? this.api.getLines(b, c, a as string)
                : this.api.getLines(a as number, b);
        });
        // Mudlet moveCursorUp/Down([window,] [lines=1,] [keepHorizontal=false]).
        // Disambiguate by type of the first arg: a leading string is the window
        // name; a leading number is the lines count (window defaults to main).
        const parseMoveLineArgs = (a: unknown, b: unknown, c: unknown): [string | undefined, number, boolean] => {
            if (typeof a === 'string') {
                const lines = b === undefined ? 1 : Number(b);
                const keep = !!c;
                return [a, Number.isFinite(lines) ? lines : 1, keep];
            }
            if (a === undefined) return [undefined, 1, false];
            const lines = Number(a);
            const keep = !!b;
            return [undefined, Number.isFinite(lines) ? lines : 1, keep];
        };
        this.lua.global.set('moveCursorUp', (a?: unknown, b?: unknown, c?: unknown) => {
            const [win, lines, keep] = parseMoveLineArgs(a, b, c);
            return this.api.moveCursorUp(win, lines, keep);
        });
        this.lua.global.set('moveCursorDown', (a?: unknown, b?: unknown, c?: unknown) => {
            const [win, lines, keep] = parseMoveLineArgs(a, b, c);
            return this.api.moveCursorDown(win, lines, keep);
        });
        this.lua.global.set('moveCursorEnd',  (win?: string)=> this.api.moveCursorEnd(win));
        // moveCursor([window,] x, y) → bool. Mudlet returns true on success.
        this.lua.global.set('moveCursor', (a: string | number, b: number, c?: number) => {
            return c !== undefined
                ? this.api.moveCursor(a as string, b, c)
                : this.api.moveCursor(undefined, a as number, b);
        });
        this.lua.global.set('selectString', (a: string, b: string | number, c?: number) => {
            // selectString([window,] text, occurrence)
            return c !== undefined ? this.api.selectString(b as string, c, a) : this.api.selectString(a, b as number);
        });
        this.lua.global.set('selectSection', (a: string | number, b: number, c?: number) => {
            // selectSection([window,] from, length) → bool
            return c !== undefined
                ? this.api.selectSection(b, c, a as string)
                : this.api.selectSection(a as number, b);
        });
        this.lua.global.set('selectCurrentLine', (win?: string) => this.api.selectCurrentLine(win));
        // Mudlet getSelection([window]) → text, start, length (3 returns) or
        // false, errMsg. The wasmoon → Lua boundary returns one value, so we
        // hand back a 0-indexed [text, start, length] array (or null) and let
        // Bridge.lua unpack into the documented multi-return.
        this.lua.global.set('__getSelection', (win?: string) => {
            const sel = this.api.getSelection(win);
            return sel ? [sel.text, sel.start, sel.length] : null;
        });

        // Mudlet getFgColor([window]) / getBgColor([window]) → r, g, b at the
        // current selection's start position, or no values when there is no
        // selection / the cursor sits past the end of the line. The JS side
        // hands back a 0-indexed [r, g, b] array or null; Bridge.lua unpacks.
        this.lua.global.set('__getFgColor', (win?: unknown) => {
            const rgb = this.api.getFgColor(typeof win === 'string' ? win : undefined);
            return rgb ?? null;
        });
        this.lua.global.set('__getBgColor', (win?: unknown) => {
            const rgb = this.api.getBgColor(typeof win === 'string' ? win : undefined);
            return rgb ?? null;
        });

        // ── Temp callbacks (timer/alias/trigger/key) ──────────────────────────
        // Mudlet user code passes Lua functions to these primitives. Calling a
        // wasmoon Lua-function proxy back from a JS callback fails inside the
        // WASM bridge ("attempt to call a number value"), so the Lua wrappers
        // installed below stash the function in a Lua-side registry and pass a
        // numeric callback ID to JS instead.
        const dispatchCb = (cbId: number, label: string): void => this.dispatchCb(cbId, label);
        const releaseCb = (cbId: number): void => {
            try { this.lua.doStringSync(`__mudix_unregister_cb(${cbId})`); } catch {}
        };

        // ── Timers ────────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempTimer', (seconds: number, cbId: number, repeating?: boolean) => {
            const isRepeat = repeating ?? false;
            return this.api.timers.addTemp(seconds, () => {
                dispatchCb(cbId, 'tempTimer');
                if (!isRepeat) releaseCb(cbId);
            }, isRepeat);
        });
        // Mudlet `killTimer(idOrName)`: numeric id kills a temp timer; a name
        // string removes a permanent timer (and any group sharing the name).
        this.lua.global.set('killTimer', (idOrName: number | string) =>
            typeof idOrName === 'string'
                ? this.api.killByName('timer', idOrName)
                : this.api.timers.killTimer(idOrName));

        // ── Aliases ───────────────────────────────────────────────────────────
        this.lua.global.set('__mudix_tempAlias', (pattern: string, cbId: number) => {
            const id = this.nextTempId++;
            const unsub = this.api.aliases.addTemp(pattern, (m: RegExpMatchArray) => {
                this.setMatches(Array.from(m));
                dispatchCb(cbId, 'tempAlias');
            });
            this.tempIds.set(id, () => { unsub(); releaseCb(cbId); });
            return id;
        });
        this.lua.global.set('killAlias', (idOrName: number | string) => {
            if (typeof idOrName === 'string') return this.api.killByName('alias', idOrName);
            const unsub = this.tempIds.get(idOrName);
            if (!unsub) return false;
            unsub(); this.tempIds.delete(idOrName); return true;
        });

        // ── Triggers ──────────────────────────────────────────────────────────
        // Mudlet semantics:
        //   tempTrigger(pattern, fn, [expirationCount])              — substring match
        //   tempRegexTrigger(pattern, fn, [expirationCount])         — PCRE match
        //   tempExactMatchTrigger(pattern, fn, [expirationCount])    — full-line equality
        //   tempBeginOfLineTrigger(pattern, fn, [expirationCount])   — literal prefix (startsWith)
        // All share auto-expiration: positive N auto-removes the trigger after
        // N fires; -1/0/omitted = unlimited. The Bridge.lua wrappers dispatch
        // to one of the JS bindings below.
        const installTempTrigger = (
            pattern: string, cbId: number, kind: 'regex' | 'substring' | 'startOfLine' | 'exactMatch',
            expirationCount: number | undefined, label: string,
        ) => {
            const id = this.nextTempId++;
            const max = (typeof expirationCount === 'number' && expirationCount > 0) ? expirationCount : -1;
            let fires = 0;
            let killed = false;
            let unsub: () => void = () => {};
            const kill = () => {
                if (killed) return;
                killed = true;
                unsub();
                releaseCb(cbId);
                this.tempIds.delete(id);
            };
            unsub = this.api.triggers.addTemp(pattern, (matches, spans) => {
                if (killed) return;
                const prevSpans = this.currentCaptureSpans;
                const prevNamed = this.currentNamedSpans;
                const prevMatches = this.currentMatches;
                const prevFullMatchSpan = this.currentFullMatchSpan;
                this.currentMatches = matches;
                this.currentCaptureSpans = spans?.captureSpans ?? [];
                this.currentNamedSpans = spans?.namedSpans ?? {};
                this.currentFullMatchSpan = spans?.matchSpan ?? null;
                this.setMatches(matches);
                try {
                    dispatchCb(cbId, label);
                } finally {
                    this.currentMatches = prevMatches;
                    this.currentCaptureSpans = prevSpans;
                    this.currentNamedSpans = prevNamed;
                    this.currentFullMatchSpan = prevFullMatchSpan;
                }
                fires++;
                if (max > 0 && fires >= max) kill();
            }, kind);
            this.tempIds.set(id, kill);
            return id;
        };
        this.lua.global.set('__mudix_tempTrigger', (pattern: string, cbId: number, expirationCount?: number) =>
            installTempTrigger(pattern, cbId, 'substring', expirationCount, 'tempTrigger'));
        this.lua.global.set('__mudix_tempRegexTrigger', (pattern: string, cbId: number, expirationCount?: number) =>
            installTempTrigger(pattern, cbId, 'regex', expirationCount, 'tempRegexTrigger'));
        this.lua.global.set('__mudix_tempExactMatchTrigger', (pattern: string, cbId: number, expirationCount?: number) =>
            installTempTrigger(pattern, cbId, 'exactMatch', expirationCount, 'tempExactMatchTrigger'));
        this.lua.global.set('__mudix_tempBeginOfLineTrigger', (pattern: string, cbId: number, expirationCount?: number) =>
            installTempTrigger(pattern, cbId, 'startOfLine', expirationCount, 'tempBeginOfLineTrigger'));
        this.lua.global.set('killTrigger', (idOrName: number | string) => {
            if (typeof idOrName === 'string') return this.api.killByName('trigger', idOrName);
            const unsub = this.tempIds.get(idOrName);
            if (!unsub) return false;
            unsub(); this.tempIds.delete(idOrName); return true;
        });

        // ── Keys ──────────────────────────────────────────────────────────────
        // Mudlet `tempKey([modifier,] keyCode, fn)`. modifier is a Qt::Key-
        // boardModifier bitmask (default 0 = no modifier); keyCode is a
        // Qt::Key int. The Bridge.lua wrapper resolves the optional-modifier
        // overload before passing here.
        this.lua.global.set('__mudix_tempKey', (modifier: number, key: string | number, cbId: number) => {
            const mods = qtModifiersToList(modifier);
            const keyCode = qtKeyToDomCode(key, modifier);
            return this.api.keys.addTemp(keyCode, mods, () => {
                dispatchCb(cbId, 'tempKey');
            });
        });
        this.lua.global.set('killKey', (idOrName: number | string) =>
            typeof idOrName === 'string'
                ? this.api.killByName('key', idOrName)
                : this.api.keys.killKey(idOrName));

        // ── Error / debug ─────────────────────────────────────────────────────
        // showHandlerError is called by Other.lua's dispatchEventToFunctions when
        // a handler throws — it's a C++ function in Mudlet, bridged here.
        this.lua.global.set('showHandlerError', (event: string, error: string) => {
            this.api.printError(`[event "${event}"] ${error}`);
        });
        // Mudlet `debugc(content)` and `errorc(content, [debugInfo])` both
        // accept a single content arg (plus an optional debug-info string on
        // errorc). They route to Mudlet's "Errors" console; mudix has no
        // equivalent dock, so debugc lands in devtools and errorc routes
        // through the script log (same destination as printError).
        this.lua.global.set('debugc', (content: unknown) => {
            console.debug('[Lua]', String(content ?? ''));
        });
        this.lua.global.set('errorc', (content: unknown, debugInfo?: unknown) => {
            const msg = String(content ?? '');
            const trailer = debugInfo == null ? '' : ` ${String(debugInfo)}`;
            this.api.printError(msg + trailer);
        });

        // ── Send / alias ──────────────────────────────────────────────────────
        // Mudlet `expandAlias(text, [echo])`. Default for `echo` is **true**
        // — Mudlet's TLuaInterpreter::expandAlias initialises `wantPrint = true`
        // and only honours an explicit boolean 2nd arg. The command is echoed
        // in the main window the same way a typed-in alias would be. Passing
        // `false` opts out. Returns true once the expansion is dispatched.
        this.lua.global.set('expandAlias', (text: unknown, echo?: unknown) => {
            this.api.expandAlias(String(text ?? ''), echo == null ? true : !!echo);
            this.api.flushOutput();
            return true;
        });
        // Mudlet sendCmdLine([cmdLineName,] text) stages text into the command
        // bar (setPlainText + selectAll) without submitting it. Scripts use
        // this to pre-fill the input for the user to edit before pressing
        // Enter. The cmdLineName arg is ignored — mudix has a single command
        // bar.
        this.lua.global.set('sendCmdLine', (a: unknown, b?: unknown) => {
            const text = b !== undefined ? String(b ?? '') : String(a ?? '');
            this.api.printCmdLine(text);
        });

        // ── Text manipulation ─────────────────────────────────────────────────
        this.lua.global.set('replace', (a: unknown, b?: unknown, c?: unknown) => {
            // Mudlet calling conventions:
            //   replace(with)
            //   replace(with, keepcolor)
            //   replace(window, with [, keepcolor])
            // Disambiguate the 2-arg form by typeof b: string ⇒ window form,
            // boolean ⇒ keepcolor form.
            let win: string | undefined;
            let text: string;
            let keepColor = false;
            if (c !== undefined) {
                win = a as string;
                text = String(b ?? '');
                keepColor = !!c;
            } else if (typeof b === 'string') {
                win = a as string;
                text = b;
            } else if (b !== undefined) {
                text = String(a ?? '');
                keepColor = !!b;
            } else {
                text = String(a ?? '');
            }
            this.api.replace(text, win, keepColor);
        });
        // Mudlet `selectCaptureGroup(groupNumber|groupName)`. Numeric form
        // selects group N (1-indexed; N=0 is invalid). Mudlet's convention:
        //   N=1 → full regex match (NOT the first capture)
        //   N=2 → first explicit capture
        //   N=k → (k-1)th explicit capture
        // Named form selects the (?<name>...) capture by name. Returns the
        // start column of the selection, or -1 if no such capture / unmatched.
        this.lua.global.set('selectCaptureGroup', (groupOrName: number | string) => {
            if (typeof groupOrName === 'number') {
                if (groupOrName < 1) return -1;
                if (groupOrName === 1) {
                    if (this.currentFullMatchSpan) {
                        if (this.currentFullMatchSpan.length === 0) return -1;
                        this.api.selectSection(this.currentFullMatchSpan.start, this.currentFullMatchSpan.length);
                        return this.currentFullMatchSpan.start;
                    }
                    // No span (substring/startOfLine perm trigger): pick the
                    // first textual occurrence of the matched text.
                    const text = this.currentMatches[0] ?? '';
                    return text ? this.api.selectString(text, 1) : -1;
                }
                // Group N>1 is the (N-1)th explicit capture. currentMatches is
                // [fullLine, cap1, cap2, ...], so the text sits at index N-1
                // and the span at N-2 in currentCaptureSpans (which holds only
                // explicit captures).
                const captureIdx = groupOrName - 1;
                if (captureIdx >= this.currentMatches.length) return -1;
                const text = this.currentMatches[captureIdx];
                const span = this.currentCaptureSpans[captureIdx - 1];
                if (!span) return text ? this.api.selectString(text, 1) : -1;
                if (span.length === 0) return -1;
                this.api.selectSection(span.start, span.length);
                return span.start;
            }
            const span = this.currentNamedSpans[groupOrName];
            if (!span || span.length === 0) return -1;
            this.api.selectSection(span.start, span.length);
            return span.start;
        });

        // ── Network ───────────────────────────────────────────────────────────
        // Mudlet `getNetworkLatency()` returns seconds (float). Our cached
        // value is in ms — convert to seconds for the script side. The cache
        // returns -1 when no measurement has been recorded yet; we propagate
        // that sentinel unchanged.
        this.lua.global.set('getNetworkLatency', () => {
            const ms = this.api.getNetworkLatency();
            return ms < 0 ? -1 : ms / 1000;
        });

        // ── HTTP / downloads ──────────────────────────────────────────────────
        // Mudlet's HTTP API is fire-and-forget. The service runs each request
        // in the background and reports completion via sysXxxHttpDone /
        // sysDownloadDone events; we route those through emitEvent so they
        // dispatch to user handlers the same as gmcp/connect/etc. Late-arriving
        // emits after destroy() are no-ops thanks to the `destroyed` guard.
        this.http = new HttpService(
            (event, args) => this.emitEvent(event, args),
            () => this.vfs,
            this.proxyUrlGetter,
        );
        // Mudlet HTTP APIs all return (true, url) immediately and then surface
        // success/error via sysXxxHttp* events. The JS bindings below just kick
        // off the background request; the (true, url) tuple is added by the
        // Bridge.lua wrappers that call these `__` primitives.
        this.lua.global.set('__downloadFile', (saveTo: unknown, url: unknown) => {
            this.http.downloadFile(String(saveTo ?? ''), String(url ?? ''));
        });
        this.lua.global.set('__getHTTP', (url: unknown, headers?: unknown) => {
            this.http.getHTTP(String(url ?? ''), luaTableToHeaders(headers));
        });
        this.lua.global.set('__postHTTP', (data: unknown, url: unknown, headers?: unknown, file?: unknown) => {
            this.http.postHTTP(
                data == null ? null : String(data),
                String(url ?? ''),
                luaTableToHeaders(headers),
                file == null ? undefined : String(file),
            );
        });
        this.lua.global.set('__putHTTP', (data: unknown, url: unknown, headers?: unknown, file?: unknown) => {
            this.http.putHTTP(
                data == null ? null : String(data),
                String(url ?? ''),
                luaTableToHeaders(headers),
                file == null ? undefined : String(file),
            );
        });
        this.lua.global.set('__deleteHTTP', (url: unknown, headers?: unknown) => {
            this.http.deleteHTTP(String(url ?? ''), luaTableToHeaders(headers));
        });
        // Mudlet customHTTP(method, data, url, headers, [file]). The optional
        // file arg replaces `data` with the bytes read from the VFS path.
        this.lua.global.set('__customHTTP', (method: unknown, data: unknown, url: unknown, headers?: unknown, file?: unknown) => {
            this.http.customHTTP(
                String(method ?? ''),
                data == null ? null : String(data),
                String(url ?? ''),
                luaTableToHeaders(headers),
                file == null ? undefined : String(file),
            );
        });

        // ── Sounds (Mudlet playSoundFile / playMusicFile / stopSounds / stopMusic) ─
        // Web Audio backend lives on session.sounds. Lua passes either a positional
        // (filename [, volume]) form for playSoundFile, or a Mudlet-style options
        // table for both play* and stopMusic. Bridge.lua normalises positional →
        // table before reaching these primitives.
        const sounds = this.api.sounds;
        const detachOpts = (t: unknown): Record<string, unknown> => {
            if (!t || typeof t !== 'object') return {};
            const proxy = t as { $detach?: (dt: number) => Record<string, unknown> };
            return typeof proxy.$detach === 'function' ? proxy.$detach(1) : (t as Record<string, unknown>);
        };
        const numOpt = (v: unknown): number | undefined => {
            if (v === undefined || v === null) return undefined;
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        };
        const strOpt = (v: unknown): string | undefined => {
            if (v === undefined || v === null) return undefined;
            const s = String(v);
            return s.length > 0 ? s : undefined;
        };
        this.lua.global.set('__playSoundFile', (t: unknown) => {
            const o = detachOpts(t);
            void sounds.playSound({
                name: String(o.name ?? ''),
                volume: numOpt(o.volume),
                fadein: numOpt(o.fadein),
                fadeout: numOpt(o.fadeout),
                start: numOpt(o.start),
                loops: numOpt(o.loops),
                key: strOpt(o.key),
                tag: strOpt(o.tag),
            });
            return true;
        });
        this.lua.global.set('__playMusicFile', (t: unknown) => {
            const o = detachOpts(t);
            void sounds.playMusic({
                name: String(o.name ?? ''),
                volume: numOpt(o.volume),
                fadein: numOpt(o.fadein),
                fadeout: numOpt(o.fadeout),
                start: numOpt(o.start),
                loops: numOpt(o.loops),
                key: strOpt(o.key),
                tag: strOpt(o.tag),
                continue: o.continue === true || o['continue'] === true,
            });
            return true;
        });
        this.lua.global.set('stopSounds', () => { sounds.stopSounds(); });
        this.lua.global.set('__stopMusic', (t?: unknown) => {
            const o = detachOpts(t);
            sounds.stopMusic({
                name: strOpt(o.name),
                key: strOpt(o.key),
                tag: strOpt(o.tag),
                fadeout: numOpt(o.fadeout),
            });
        });

        // ── Window geometry ───────────────────────────────────────────────────
        // Returns [w, h] from JS; a Lua wrapper below unpacks it to two values.
        // __getUserWindowSize returns null when the window doesn't exist so
        // Bridge.lua can shape it as (nil, errMsg) (Mudlet miss-shape).
        this.lua.global.set('__getMainWindowSize', () => this.api.getMainWindowSize());
        this.lua.global.set('__getMousePosition', () => this.api.getMousePosition());
        this.lua.global.set('__getUserWindowSize', (name: unknown) => {
            const n = String(name ?? '');
            if (!n || !this.api.windows.has(n)) return null;
            return this.api.getUserWindowSize(n);
        });

        // setFontSize([windowName,] size) / getFontSize([windowName]) — Mudlet
        // overloads by arg count. Distinguish on first-arg type. The raw
        // primitives below return false / null for miss cases; Bridge.lua
        // re-shapes those into Mudlet's (nil, errMsg) multi-return.
        this.lua.global.set('__setFontSize', (a: unknown, b?: unknown) => {
            return (typeof a === 'string')
                ? this.api.setFontSize(Number(b), a)
                : this.api.setFontSize(Number(a));
        });
        this.lua.global.set('__getFontSize', (a?: unknown) => {
            const size = (typeof a === 'string')
                ? this.api.getFontSize(a)
                : this.api.getFontSize();
            return size ?? null;
        });

        // Mudlet setMiniConsoleFontSize(name, size) — miniconsole-only sibling
        // of setFontSize. Raw entry returns false on miss; Bridge.lua re-shapes
        // it into Mudlet's (nil, errMsg) failure shape.
        this.lua.global.set('__setMiniConsoleFontSize', (name: unknown, size: unknown) => {
            if (typeof name !== 'string') return false;
            return this.api.setMiniConsoleFontSize(name, Number(size));
        });

        // setFont([windowName,] family) / getFont([windowName]). Mudlet returns
        // (nil, errMsg) when the named window doesn't exist; Bridge.lua re-
        // shapes the JS bool/string from the raw primitives below.
        this.lua.global.set('__setFont', (a: unknown, b?: unknown) => {
            return (typeof b === 'string' || typeof b === 'number')
                ? this.api.setFont(String(b), String(a ?? ''))
                : this.api.setFont(String(a ?? ''));
        });
        this.lua.global.set('__getFont', (a?: unknown) => {
            const family = (typeof a === 'string')
                ? this.api.getFont(a)
                : this.api.getFont();
            return family ?? null;
        });

        // Mudlet getAvailableFonts() — set-style table {[family] = true}. JS
        // returns a plain object with string keys, which wasmoon converts to a
        // Lua table directly (same path as getBorderSizes). See ScriptingAPI
        // for what goes into the merged set.
        this.lua.global.set('getAvailableFonts', () => this.api.getAvailableFonts());

        // Mudlet calcFontSize(size [, family]) | calcFontSize(windowName).
        // Dispatches on first-arg type — Lua-style: numeric strings (e.g. from
        // a trigger capture) coerce to the size overload. Returns [w, h] from
        // JS; Bridge.lua unpacks to two values and shapes the miss case.
        this.lua.global.set('__calcFontSize', (a: unknown, b?: unknown) => {
            let arg: number | string;
            if (typeof a === 'number') {
                arg = a;
            } else if (typeof a === 'string') {
                const n = Number(a);
                arg = (a.trim() !== '' && Number.isFinite(n)) ? n : a;
            } else {
                return null;
            }
            const fname = (typeof b === 'string' || typeof b === 'number') ? String(b) : undefined;
            return this.api.calcFontSize(arg, fname);
        });

        // ── Borders ───────────────────────────────────────────────────────────
        // Mudlet setBorderTop/Bottom/Left/Right, setBorderSizes, setBorderColor.
        // Numeric coercion because trigger captures arrive as Lua strings.
        this.lua.global.set('setBorderTop',    (n: unknown) => this.api.setBorderTop(Number(n)));
        this.lua.global.set('setBorderBottom', (n: unknown) => this.api.setBorderBottom(Number(n)));
        this.lua.global.set('setBorderLeft',   (n: unknown) => this.api.setBorderLeft(Number(n)));
        this.lua.global.set('setBorderRight',  (n: unknown) => this.api.setBorderRight(Number(n)));

        // Mudlet setBorderSizes follows CSS-shorthand semantics:
        //   1 arg  → uniform
        //   2 args → (vertical, horizontal)
        //   3 args → (top, horizontal, bottom)
        //   4 args → (top, right, bottom, left)
        // ScriptingAPI.setBorderSizes does the case-split; we forward only the
        // args that were actually passed so the undefined slots stay undefined.
        this.lua.global.set('setBorderSizes', (a?: unknown, b?: unknown, c?: unknown, d?: unknown) => {
            const num = (v: unknown) => v === undefined ? undefined : Number(v);
            this.api.setBorderSizes(num(a), num(b), num(c), num(d));
        });

        this.lua.global.set('getBorderTop',    () => this.api.getBorderTop());
        this.lua.global.set('getBorderBottom', () => this.api.getBorderBottom());
        this.lua.global.set('getBorderLeft',   () => this.api.getBorderLeft());
        this.lua.global.set('getBorderRight',  () => this.api.getBorderRight());

        // Mudlet returns a Lua table {top, right, bottom, left}; wasmoon converts
        // a plain JS object the same way, so a direct return suffices.
        this.lua.global.set('getBorderSizes',  () => this.api.getBorderSizes());

        // Mudlet setBorderColor(r, g, b). Channels are validated as 0..255 ints
        // (same `channel()` helper used by setFgColor/setBgColor); invalid args
        // produce a silent no-op. Mudlet forces alpha to 255 — an alpha arg is
        // accepted for parity and ignored.
        this.lua.global.set('setBorderColor', (r: unknown, g: unknown, b: unknown, _a?: unknown) => {
            const rr = channel(r);
            const gg = channel(g);
            const bb = channel(b);
            if (rr === null || gg === null || bb === null) return;
            this.api.setBorderColor(rr, gg, bb, 255);
        });
        this.lua.global.set('resetBorderColor', () => this.api.resetBorderColor());

        // ── Timers (extended) ─────────────────────────────────────────────────
        // Mudlet remainingTime(idOrName). Numeric arg → tempTimer id; string
        // arg → permanent timer name. -1 when no live timer matches.
        this.lua.global.set('remainingTime', (idOrName: unknown) => {
            if (typeof idOrName === 'number') return this.api.timers.remainingTime(idOrName);
            if (typeof idOrName === 'string') return this.api.timers.remainingTime(idOrName);
            return -1;
        });

        // Bootstrap chunks run sync — none of them yield. setupRex needs an
        // await for one-time PCRE wasm init; sqliteReady gates the SQL bridge
        // until the sqlite module has finished loading.
        this.lua.doStringSync(BRIDGE_LUA);
        await setupRex(this.lua);
        this.lua.doStringSync(EXEC_LUA);
        this.execModule(UTF8, 'utf8', 'utf8');

        // Built-in Lua files served read-only via the VFS at /lua/<relative-path>.
        // Derived from mudlet-lua/ directory; keys mirror the paths LuaGlobal.lua
        // constructs with luaGlobalPath="/lua" (e.g. /lua/3rdparty/Inspect.lua).
        const builtins = new Map(
            Object.entries(MUDLET_LUA_FILES).map(([p, src]) => {
                const rel = p.slice('./mudlet-lua/'.length);
                return [`/lua/${rel}`, src] as [string, string];
            })
        );
        this.setupVFS(this.vfs, builtins);
        this.exec(VFS_LUA, 'VFS');
        this.exec(LUA_GLOBAL_SETUP, 'lua-globals-setup');
        await sqliteReady;
        this.setupSqlBridge();
        this.exec(LUASQL_LUA, 'Luasql');
        this.toLuaValue = setupYajl(this.lua).transform;
        this.exec(YAJL_LUA, 'Yajl');
        this.exec(LUAGLOBAL, 'LuaGlobal');
    }

    // ── luasql.sqlite3 bridge ────────────────────────────────────────────────
    // Exposes globals consumed by Luasql.lua: __sql_open / __sql_exec /
    // __sql_close / __sql_escape. All synchronous — sqlite runs on the main
    // thread, so Lua doesn't need to yield Promises.
    //
    // VFS round-trip: on open we preload from the ProfileVFS via
    // sqlite3_deserialize; the VFS file is the source of truth. After each
    // mutation we schedule a debounced snapshot (setTimeout) back to the same
    // VFS path so a tight INSERT loop coalesces into one write.
    //
    // Row arrays are 1-indexed for Lua: wasmoon's pushTable iterates
    // Object.keys, so a sparse JS array with index 0 absent and 1..n populated
    // lands in Lua as a clean 1-indexed sequence.
    private setupSqlBridge(): void {
        const sql = getSqliteClient();

        const toLuaArray = <T>(arr: T[]): T[] => {
            const r: T[] = [];
            for (let i = 0; i < arr.length; i++) r[i + 1] = arr[i];
            return r;
        };

        const SNAPSHOT_DEBOUNCE_MS = 500;
        const dbPaths = new Map<number, string>();
        const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

        const snapshotNow = (dbId: number): void => {
            const path = dbPaths.get(dbId);
            if (!path || !this.vfs) return;
            try {
                const bytes = sql.exportFile(dbId);
                // sqlite3_js_db_export returns an empty Uint8Array for an
                // in-memory DB with no committed pages (a bare connect+close
                // with no DDL/DML). Writing 0 bytes would poison the VFS path:
                // the next __sql_open would read it back and reject it as too
                // small for a SQLite header. Skip the write instead.
                if (bytes.byteLength === 0) return;
                this.vfs.writeBinaryFile(path, bytes);
            } catch (e) {
                console.warn('[sql snapshot]', path, e);
            }
        };

        const scheduleSnapshot = (dbId: number): void => {
            if (!this.vfs) return;
            const prev = pendingTimers.get(dbId);
            if (prev) clearTimeout(prev);
            const t = setTimeout(() => {
                pendingTimers.delete(dbId);
                snapshotNow(dbId);
            }, SNAPSHOT_DEBOUNCE_MS);
            pendingTimers.set(dbId, t);
        };

        this.flushPendingSqlSnapshots = () => {
            for (const [dbId, t] of pendingTimers) {
                clearTimeout(t);
                snapshotNow(dbId);
            }
            pendingTimers.clear();
        };

        this.lua.global.set('__sql_open', (path: unknown): number => {
            const p = String(path);
            let preload: Uint8Array | undefined;
            if (this.vfs && this.vfs.exists(p)) {
                let raw: Uint8Array;
                try {
                    raw = this.vfs.readBinaryFile(p);
                } catch (e) {
                    throw new Error(`VFS read of '${p}' failed: ${e instanceof Error ? e.message : String(e)}`);
                }
                // Normalize to a fresh, byteOffset=0, standalone Uint8Array —
                // ZenFS may return a Buffer slice that spans only part of an
                // underlying ArrayBuffer.
                const fresh = new Uint8Array(raw.byteLength);
                fresh.set(raw);
                // 0-byte file: treat as if the DB doesn't exist yet. snapshotNow
                // now skips empty exports, but older sessions or interrupted runs
                // may have left a 0-byte file behind that would otherwise jam
                // every future open of this path.
                if (fresh.byteLength === 0) {
                    console.warn(`[__sql_open] '${p}' exists as 0 bytes — opening as fresh database`);
                } else if (fresh.byteLength < 512) {
                    throw new Error(`VFS file '${p}' is ${fresh.byteLength} bytes, too small to be a SQLite database`);
                } else {
                    // Quick header sniff — SQLite files start with "SQLite format 3\0".
                    const HDR = 'SQLite format 3\0';
                    let headerOk = true;
                    for (let i = 0; i < HDR.length; i++) {
                        if (fresh[i] !== HDR.charCodeAt(i)) { headerOk = false; break; }
                    }
                    if (!headerOk) {
                        throw new Error(`VFS file '${p}' is not a SQLite database (bad header). First bytes: ${Array.from(fresh.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                    }
                    preload = fresh;
                }
            }
            const dbId = sql.open(p, preload);
            dbPaths.set(dbId, p);
            return dbId;
        });

        this.lua.global.set('__sql_exec', (dbId: unknown, sqlText: unknown) => {
            const id = Number(dbId);
            try {
                const r = sql.exec(id, String(sqlText));
                if (r.kind === 'rows') {
                    // Return rows as a Lua source literal instead of a nested
                    // JS array. wasmoon's pushTable crosses the JS↔WASM boundary
                    // once per cell — for a fetch of N rows × M columns that's
                    // N*M crossings, which dominates large-result paths. By
                    // emitting `{{...},{...},...}` and letting Lua's loadstring
                    // parse it, we replace N*M boundary crossings with one
                    // string push plus an in-wasm parse.
                    const rowsSrc = encodeRowsToLuaSource(r.rows as unknown[][]);
                    const cols1 = toLuaArray(r.columns);
                    return {kind: 'rows', rowsSrc, columns: cols1};
                }
                // Any non-query (INSERT/UPDATE/DELETE/DDL) — schedule a debounced
                // VFS snapshot. Coalesces a tight db:add loop into one write.
                scheduleSnapshot(id);
                return {kind: 'changes', changes: r.changes};
            } catch (e) {
                return {kind: 'error', message: e instanceof Error ? e.message : String(e)};
            }
        });

        this.lua.global.set('__sql_close', (dbId: unknown): boolean => {
            const id = Number(dbId);
            try {
                const t = pendingTimers.get(id);
                if (t) { clearTimeout(t); pendingTimers.delete(id); }
                snapshotNow(id);
                sql.close(id);
                dbPaths.delete(id);
                return true;
            } catch {
                return false;
            }
        });

        this.lua.global.set('__sql_escape', (s: unknown): string => sql.escape(String(s ?? '')));
    }

    // ── VFS bridge ───────────────────────────────────────────────────────────

    /**
     * Fire sysPathChanged for any addFileWatch subscription whose path equals
     * `changedPath` or is an ancestor directory of it. Mudlet's QFileSystemWatcher
     * reports the *watched* path (not the inner file) for directory watches, so
     * we do the same — handlers comparing `path == watchedPath` round-trip.
     */
    private notifyVfsPathChange(changedPath: string): void {
        if (this.watchedPaths.size === 0) return;
        if (this.watchedPaths.has(changedPath)) {
            this.emitEvent('sysPathChanged', [changedPath]);
        }
        for (const watched of this.watchedPaths) {
            if (watched !== changedPath && changedPath.startsWith(watched + '/')) {
                this.emitEvent('sysPathChanged', [watched]);
            }
        }
    }

    private setupVFS(vfs: ProfileVFS | null, builtins = new Map<string, string>()): void {
        let nextId = 1;
        let lastError = '';

        interface Handle {
            path: string;
            mode: string;
            content: string;
            pos: number;
            dirty: boolean;
        }

        const handles = new Map<number, Handle>();

        this.lua.global.set('__vfs_err__', () => lastError);
        this.lua.global.set('__vfs_exists__', (path: string) =>
            builtins.has(path) || (vfs ? vfs.exists(path) : false));
        this.lua.global.set('__vfs_profile_dir__', () => vfs?.profilePath ?? '/profiles/default');

        this.lua.global.set('__vfs_io_open__', (filename: string, mode: string): number | null => {
            try {
                const m = (mode ?? 'r').replace(/b/g, '');
                let content = '';
                let resolvedPath = filename;
                let dirty = false;

                if (builtins.has(filename)) {
                    if (m !== 'r') { lastError = `cannot open '${filename}': read-only`; return null; }
                    content = builtins.get(filename)!;
                } else if (vfs) {
                    resolvedPath = vfs.resolvePath(filename);
                    if (m === 'r' || m === 'r+') {
                        if (!vfs.exists(filename)) {
                            lastError = `cannot open '${filename}': No such file or directory`;
                            return null;
                        }
                        content = vfs.readFile(filename);
                    } else if (m === 'a' || m === 'a+') {
                        if (vfs.exists(filename)) content = vfs.readFile(filename);
                    }
                    dirty = m === 'w' || m === 'w+';
                } else {
                    lastError = `cannot open '${filename}': No such file or directory`;
                    return null;
                }

                const id = nextId++;
                handles.set(id, {
                    path: resolvedPath,
                    mode: m,
                    content,
                    pos: m.startsWith('a') ? content.length : 0,
                    dirty,
                });
                return id;
            } catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                return null;
            }
        });

        this.lua.global.set('__vfs_io_read__', (id: number, fmt: string | number): string | number | null => {
            const h = handles.get(id);
            if (!h) { lastError = 'invalid file handle'; return null; }
            if (h.mode === 'w' || h.mode === 'a') { lastError = 'file is write-only'; return null; }

            if (typeof fmt === 'number') {
                if (fmt === 0) return '';
                const chunk = h.content.substring(h.pos, h.pos + fmt);
                if (chunk.length === 0) return null;
                h.pos += chunk.length;
                return chunk;
            }

            // Lua 5.1's liolib only inspects the character after '*', so '*all'
            // and '*a' both mean "read entire file". Match that behavior.
            const raw = (fmt ?? '*l').toString();
            const f = (raw.startsWith('*') ? raw.charAt(1) : raw.charAt(0)) || 'l';

            if (f === 'l' || f === 'L') {
                if (h.pos >= h.content.length) return null;
                const nl = h.content.indexOf('\n', h.pos);
                if (nl === -1) {
                    const line = h.content.substring(h.pos);
                    h.pos = h.content.length;
                    return f === 'L' ? line + '\n' : line;
                }
                const line = h.content.substring(h.pos, nl);
                h.pos = nl + 1;
                return f === 'L' ? line + '\n' : line;
            }
            if (f === 'a') {
                const rest = h.content.substring(h.pos);
                h.pos = h.content.length;
                return rest;
            }
            if (f === 'n') {
                const m = h.content.substring(h.pos).match(/^\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
                if (!m) return null;
                h.pos += m[0].length;
                return parseFloat(m[1]);
            }
            return null;
        });

        this.lua.global.set('__vfs_io_write__', (id: number, data: string): string | null => {
            const h = handles.get(id);
            if (!h) return 'invalid file handle';
            if (h.mode === 'r') return 'file is read-only';
            if (h.mode === 'a' || h.mode === 'a+') {
                h.content += data;
            } else {
                h.content = h.content.substring(0, h.pos) + data + h.content.substring(h.pos + data.length);
                h.pos += data.length;
            }
            h.dirty = true;
            return null;
        });

        this.lua.global.set('__vfs_io_seek__', (id: number, whence: string, offset: number): number | null => {
            const h = handles.get(id);
            if (!h) { lastError = 'invalid file handle'; return null; }
            const o = offset ?? 0;
            let newPos: number;
            if ((whence ?? 'cur') === 'set') newPos = o;
            else if ((whence ?? 'cur') === 'cur') newPos = h.pos + o;
            else if (whence === 'end') newPos = h.content.length + o;
            else { lastError = 'invalid whence'; return null; }
            h.pos = Math.max(0, Math.min(newPos, h.content.length));
            return h.pos;
        });

        this.lua.global.set('__vfs_io_close__', (id: number): string | null => {
            const h = handles.get(id);
            if (!h) return 'invalid file handle';
            try {
                if (h.dirty && vfs) {
                    vfs.writeFile(h.path, h.content);
                    this.notifyVfsPathChange(h.path);
                }
                handles.delete(id);
                return null;
            } catch (e) {
                handles.delete(id);
                return e instanceof Error ? e.message : String(e);
            }
        });

        this.lua.global.set('__vfs_os_remove__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            const abs = vfs.resolvePath(path);
            try { vfs.deleteFile(path); this.notifyVfsPathChange(abs); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_os_rename__', (oldPath: string, newPath: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            const oldAbs = vfs.resolvePath(oldPath);
            const newAbs = vfs.resolvePath(newPath);
            try {
                vfs.rename(oldPath, newPath);
                this.notifyVfsPathChange(oldAbs);
                if (oldAbs !== newAbs) this.notifyVfsPathChange(newAbs);
                return true;
            }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_chdir__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            const err = vfs.chdir(path);
            if (err) { lastError = err; return false; }
            return true;
        });

        this.lua.global.set('__vfs_lfs_currentdir__', () => vfs?.cwd ?? '/');

        this.lua.global.set('__vfs_lfs_mkdir__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            const abs = vfs.resolvePath(path);
            try { vfs.mkdir(path); this.notifyVfsPathChange(abs); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_rmdir__', (path: string): boolean => {
            if (!vfs) { lastError = 'no profile VFS'; return false; }
            const abs = vfs.resolvePath(path);
            try { vfs.rmdir(path); this.notifyVfsPathChange(abs); return true; }
            catch (e) { lastError = e instanceof Error ? e.message : String(e); return false; }
        });

        this.lua.global.set('__vfs_lfs_dir__', (path: string): string[] | null => {
            if (!vfs) { lastError = 'no profile VFS'; return null; }
            try {
                return ['.', '..', ...vfs.readdir(path)];
            } catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
                return null;
            }
        });

        this.lua.global.set('__vfs_lfs_stat__', (path: string): object | null => {
            // Builtins (Mudlet-lua JS-bundled assets) must report a stat too so
            // io.exists / lfs.attributes resolve them — loadTranslations probes
            // its JSON files via io.exists before opening them.
            if (builtins.has(path)) {
                const content = builtins.get(path)!;
                return {type: 'file', size: content.length, modification: 0, access: 0};
            }
            const s = vfs?.stat(path) ?? null;
            if (!s) return null;
            return {
                type: s.type,
                size: s.size,
                modification: Math.floor(s.mtime.getTime() / 1000),
                access: Math.floor(s.atime.getTime() / 1000),
            };
        });
    }

    // ── IScriptingRuntime ─────────────────────────────────────────────────────

    load(code: string, name: string): void {
        this.exec(code, name);
    }

    run(code: string, name: string): void {
        this.exec(code, name);
    }

    runWithMatches(
        code: string,
        name: string,
        matches: string[],
        multimatches?: string[][],
        namedGroups?: Record<string, string>,
        captureSpans?: CaptureSpan[],
        namedSpans?: Record<string, CaptureSpan>,
        fullMatchSpan?: CaptureSpan,
    ): void {
        const prevMatches = this.currentMatches;
        const prevSpans = this.currentCaptureSpans;
        const prevNamedSpans = this.currentNamedSpans;
        const prevFullMatchSpan = this.currentFullMatchSpan;
        this.currentMatches = matches;
        this.currentCaptureSpans = captureSpans ?? [];
        this.currentNamedSpans = namedSpans ?? {};
        this.currentFullMatchSpan = fullMatchSpan ?? null;
        this.setMatches(matches, multimatches, namedGroups);
        try {
            this.execInner(code, name);
        } finally {
            this.currentMatches = prevMatches;
            this.currentCaptureSpans = prevSpans;
            this.currentNamedSpans = prevNamedSpans;
            this.currentFullMatchSpan = prevFullMatchSpan;
        }
    }

    // wasmoon's pushTable iterates Object.keys(arr) and uses the keys as
    // numeric Lua indices — so a normal JS array becomes a 0-indexed Lua
    // table. Object.keys skips holes, so a sparse array with index 0 empty
    // pushes as a 1-indexed Lua sequence (which Mudlet user code expects:
    // matches[1] = full match, matches[2] = first capture).
    private setMatches(matches: string[], multimatches?: string[][], namedGroups?: Record<string, string>): void {
        const oneIndexed = (arr: string[]): string[] => {
            const t: string[] = [];
            for (let i = 0; i < arr.length; i++) t[i + 1] = arr[i];
            return t;
        };
        this.lua.global.set('matches', oneIndexed(matches));
        const mm: string[][] = [];
        if (multimatches) for (let i = 0; i < multimatches.length; i++) mm[i + 1] = oneIndexed(multimatches[i]);
        this.lua.global.set('multimatches', mm);
        // Mudlet exposes named captures as a global `namedCaptures` table;
        // user code reads it as `namedCaptures.foo`.
        this.lua.global.set('namedCaptures', namedGroups ?? {});
    }

    private exec(code: string, name: string): void {
        this.execInner(code, name);
    }

    // Run a chunk on a fresh thread and return its first return value. The
    // fresh thread isolates the chunk's frame from any caller already
    // mid-execution (e.g. a trigger handler calling expandAlias). The chunk
    // returns __exec's (err, result) tuple via the thread's stack, so we read
    // it from there instead of a global to avoid races with re-entrant exec.
    //
    // newThread() pushes a thread object onto the global stack; we have to
    // pop it via global.remove(threadIndex) in finally or the slot leaks and
    // the lua_State stack eventually overflows. close() alone is a JS-side
    // marker only — it does not pop.
    private execInner(code: string, name: string): unknown {
        const g = this.lua.global;
        const t = g.newThread();
        const threadIndex = g.getTop();
        try {
            t.loadString('return __exec(...)', '@' + name);
            t.pushValue(code);
            t.pushValue(name);
            const res = t.resume(2);
            t.assertOk(res.result);
            const top = t.getTop();
            const err = top >= 1 ? t.getValue(1) : null;
            const result = top >= 2 ? t.getValue(2) : undefined;
            if (err != null) throw new Error(String(err));
            return result;
        } finally {
            g.remove(threadIndex);
        }
    }

    // Run a chunk that doesn't return anything (event/cb/pattern dispatch).
    // The chunk's own pcall captures Lua errors; runtime/wasm errors surface
    // as a thrown JS exception that we route to the error console.
    private runChunk(chunk: string, label: string): void {
        const g = this.lua.global;
        const t = g.newThread();
        const threadIndex = g.getTop();
        try {
            t.loadString(chunk, '@' + label);
            const res = t.resume(0);
            t.assertOk(res.result);
        } catch (e) {
            this.api.printError(`[${label}] ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            g.remove(threadIndex);
        }
    }

    // Fire a registered Lua callback by id (label clicks, tempTimer/Alias/
    // Trigger/Key).
    private dispatchCb(cbId: number, label: string): void {
        this.runChunk(`__mudix_dispatch_cb(${cbId})`, label);
        this.api.flushOutput();
    }

    // Same as dispatchCb but passes a single argument to the callback. Used by
    // label mouse callbacks to deliver the {button, x, y, ...} event table.
    private dispatchCbWithArg(cbId: number, arg: unknown, label: string): void {
        if (this.destroyed) return;
        this.lua.global.set('__mudix_cb_arg', arg);
        this.runChunk(`__mudix_dispatch_cb_arg(${cbId})`, label);
        this.api.flushOutput();
    }

    // Unregister a previously registered callback id (Lua side). Used to free
    // entries in __mudix_cb on rebind so labels with rapidly-changing handlers
    // don't leak refs.
    private unregisterCb(cbId: number): void {
        if (!cbId) return;
        this.runChunk(`__mudix_unregister_cb(${cbId})`, 'unregister cb');
    }

    private execModule(code: string, name: string, globalName: string): void {
        const result = this.execInner(code, name);
        if (result !== undefined && result !== null) this.lua.global.set(globalName, result);
    }

    emitEvent(event: string, args: unknown[]): void {
        // HTTP callbacks fire from background fetches and may resolve after the
        // owning ScriptingEngine tore us down; emitting on a closed lua_State
        // throws a confusing wasm error. Drop the event silently in that case.
        if (this.destroyed) return;
        this.lua.global.set('__mudix_evt_args', args);
        this.lua.global.set('__mudix_evt_name', event);
        this.runChunk('__mudix_dispatch_event()', `event "${event}"`);
        this.api.flushOutput();
    }

    // Bridges a single GMCP message into the Lua `gmcp` global. Path is the
    // dotted server key (e.g. "Char.Vitals"); value is the JSON-decoded payload.
    // The leaf is replaced; siblings under shared parents are preserved.
    setGmcpValue(path: string, value: unknown): void {
        if (this.destroyed || !path) return;
        this.lua.global.set('__mudix_gmcp_path', path);
        this.lua.global.set('__mudix_gmcp_val', this.toLuaValue(value));
        this.runChunk('__mudix_set_gmcp(__mudix_gmcp_path, __mudix_gmcp_val)', `set-gmcp "${path}"`);
    }

    /**
     * Mudlet-style async unzip. Reads the zip from the profile VFS, decodes
     * it on a worker (fflate falls back to a chunked main-thread decode where
     * workers aren't available), writes every entry under destDir, then
     * raises sysUnzipDone / sysUnzipError. Always fire-and-forget.
     */
    private runUnzipAsync(zipPath: string, destDir: string): void {
        const vfs = this.vfs;
        const fail = (msg: string) => {
            console.warn('[unzipAsync]', msg);
            this.emitEvent('sysUnzipError', [zipPath, destDir]);
        };
        if (!vfs)         return fail('no profile VFS available');
        if (!zipPath)     return fail('zipPath is required');
        if (!destDir)     return fail('destDir is required');
        if (!vfs.exists(zipPath)) return fail(`zip not found: ${zipPath}`);

        let buf: Uint8Array;
        try { buf = vfs.readBinaryFile(zipPath); }
        catch (err) { return fail(`read failed: ${err instanceof Error ? err.message : String(err)}`); }

        const TEXT_EXT = /\.(xml|lua|txt|json|md|css|html|htm|js|csv|ini|cfg|conf|yml|yaml)$/i;
        unzip(buf, (err, entries) => {
            if (this.destroyed) return;
            if (err) return fail(`unzip failed: ${err.message}`);
            try {
                if (!vfs.exists(destDir)) vfs.mkdir(destDir);
                for (const [name, data] of Object.entries(entries)) {
                    if (name.endsWith('/')) {
                        vfs.mkdir(`${destDir}/${name}`);
                        continue;
                    }
                    const dest = `${destDir}/${name}`;
                    const parent = dest.substring(0, dest.lastIndexOf('/'));
                    if (parent && !vfs.exists(parent)) vfs.mkdir(parent);
                    if (TEXT_EXT.test(name)) vfs.writeFile(dest, strFromU8(data));
                    else                     vfs.writeBinaryFile(dest, data);
                }
                void vfs.flush();
                this.emitEvent('sysUnzipDone', [zipPath, destDir]);
            } catch (e) {
                fail(`extract failed: ${e instanceof Error ? e.message : String(e)}`);
            }
        });
    }

    setCurrentLine(line: string, _isPrompt: boolean): void {
        // Mudlet exposes the bare ANSI-stripped line as the global `line` so
        // triggers can read it without going through getCurrentLine. The
        // per-line prompt flag now travels on the buffer itself via
        // ScriptingAPI.beginLine, so we no longer need to mirror it here.
        this.lua.global.set('line', line);
    }

    dispatchSendRequest(text: string): boolean {
        this._denyCurrentSend = false;
        this.emitEvent('sysDataSendRequest', [text]);
        return this._denyCurrentSend;
    }

    killScriptHandlers(scriptId: string): void {
        if (this.destroyed) return;
        this.lua.global.set('__mudix_kill_sid', scriptId);
        this.runChunk('__mudix_kill_script_handlers(__mudix_kill_sid)', 'kill-script-handlers');
    }

    /**
     * Mudlet REGEX_LUA_CODE: the pattern body runs as a Lua function on every
     * incoming line. Side effects (raiseEvent, etc.) always run; the trigger
     * "matches" only when the body returns a truthy value.
     */
    evalTriggerPattern(code: string): boolean {
        this.lua.global.set('__mudix_pat_code', code);
        this.runChunk('__mudix_eval_pattern(__mudix_pat_code)', 'lua-pattern');
        return this.lua.global.get('__mudix_pat_result') === true;
    }

    destroy(): void {
        this.destroyed = true;
        this.api.map.setMapEventDispatcher(null);
        this.lua.global.close();
    }
}
