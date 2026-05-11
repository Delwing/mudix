import type {MudSession, ScriptLogSource, ScriptLogSourceKind} from '../mud/MudSession';
import type {AliasEngine, AliasNode} from '../mud/aliases/AliasEngine';
import {TriggerEngine, type TriggerNode} from '../mud/triggers/TriggerEngine';
import type {TimerEngine} from '../mud/timers/TimerEngine';
import type {KeyEngine, KeyNode} from '../mud/keybindings/KeyEngine';
import type {ButtonNode, ScriptNode} from '../storage/schema';
import {isEffectivelyEnabled} from '../storage/schema';
import {useAppStore} from '../storage';
import type {FormatStateSnapshot, RgbColor} from '../mud/text/FormatState';
import {AnsiAwareBuffer} from '../mud/text/FormatState';
import {ScriptingAPI} from './ScriptingAPI';
import {LuaRuntime} from './lua/LuaRuntime';
import type {IScriptingRuntime} from './IScriptingRuntime';
import {ProfileVFS} from './vfs/ProfileVFS';
import {registerVfs, unregisterVfs} from './vfs/vfsBridge';
import {rewriteVfsUrlsInCss} from './vfs/cssRewrite';
import {MapOpenNotifier} from './MapOpenNotifier';
import {installModuleFromVfsPath, installPackageFromBytes, moduleXmlAbsolutePath, reloadModuleFromVfs, uninstallPackageFiles} from '../import/packageInstaller';
import {serializeMudletXml} from '../import/mudletXmlExport';
import type {PackageManifest} from '../storage/schema';

function hexToRgb(hex: string): RgbColor | null {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    return { space: 'rgb', r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

// Lua chunks loaded with `loadstring(code, "@" .. name)` produce errors as
// `<name>:LINE: msg` (the `@` tells Lua to treat the name as a source file —
// no `[string "..."]` wrapping). Without `@` the format is `[string "<name>"]:LINE: msg`.
// We accept both by matching the first `:DIGITS: ` (trailing space ensures we
// hit the line/message separator, not a digit run inside the name).
const LUA_LINE_RE = /:(\d+):\s/;
function parseLuaErrorLine(msg: string): number | undefined {
    const m = LUA_LINE_RE.exec(msg);
    if (!m) return undefined;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function formatErrorPrefix(kind: ScriptLogSourceKind, name: string): string {
    switch (kind) {
        case 'script':
        case 'alias':
            return name;
        case 'trigger': return `trigger "${name}"`;
        case 'timer':   return `timer "${name}"`;
        case 'key':     return `key "${name}"`;
        case 'button':  return `button "${name}"`;
    }
}

// Some MUDs send lines that carry only ANSI colour codes (no visible text) between
// real output lines — an artifact of how they format their output.  Filtering them
// removes unintended blank lines, but also removes intentional spacing in MUDs that
// use ANSI-only lines deliberately.  Toggle this flag per preference.
const FILTER_ANSI_ONLY_LINES = true;

/**
 * Compare the slice of nodes tagged with `pkgName` between two arrays. Returns
 * true if any tagged node was added, removed, or replaced (Zustand mutators
 * always produce new node references for changed items, so reference equality
 * is sufficient).
 */
/**
 * Effective load priority of a node: looks up the owning module's priority,
 * defaulting to 0 for profile-owned nodes (no `packageName`) and for tagged
 * nodes whose package isn't in the priority map (e.g. plain non-module
 * packages, which Mudlet treats as priority 0).
 */
function priorityFor(node: { packageName?: string }, priorityMap: Map<string, number>): number {
    if (!node.packageName) return 0;
    return priorityMap.get(node.packageName) ?? 0;
}

function hasTaggedSliceChanged<T extends { id: string; packageName?: string }>(
    pkgName: string,
    next: T[] | undefined,
    prev: T[] | undefined,
): boolean {
    if (next === prev) return false;
    const a = (prev ?? []).filter(n => n.packageName === pkgName);
    const b = (next ?? []).filter(n => n.packageName === pkgName);
    if (a.length !== b.length) return true;
    const byId = new Map(a.map(n => [n.id, n]));
    for (const n of b) {
        const old = byId.get(n.id);
        if (old !== n) return true;
    }
    return false;
}

export class ScriptingEngine {
    private runtimes: { lua: IScriptingRuntime | null } = { lua: null };
    private readonly unsubs: (() => void)[] = [];
    private readonly api: ScriptingAPI;
    private promptPending = false;
    private vfs: ProfileVFS | null = null;
    private readonly runtimeReady: Promise<IScriptingRuntime>;
    private readonly mapOpen = new MapOpenNotifier(() => this.raiseEvent('mapOpenEvent'));
    private readonly connectionId: string;
    private storeUnsub: (() => void) | null = null;
    // Triggers can't apply until the PCRE wasm has initialized — we hold
    // off the first apply (and any subsequent store updates for triggers)
    // until TriggerEngine.ready() resolves.
    private triggersReady = false;
    // Last seen script list for the active connection. Used to diff against
    // the next store update so we know which scripts to load/unload.
    private prevScripts: ScriptNode[] = [];
    // Pending debounced XML writes for sync-enabled modules (key: module name).
    private moduleSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private static readonly MODULE_SYNC_DEBOUNCE_MS = 500;

    // Mudlet's permScript/permRegexTrigger/setScript return a numeric script id;
    // our store keys nodes by UUID. Hand each UUID a stable monotonic int when
    // we first hit it so Lua callers see consistent numeric identity (and code
    // doing `tbl[id] = x` doesn't break the way a UUID string would).
    private uuidToNumericId = new Map<string, number>();
    private nextNumericId = 1;
    private numericIdFor(uuid: string): number {
        let n = this.uuidToNumericId.get(uuid);
        if (n === undefined) { n = this.nextNumericId++; this.uuidToNumericId.set(uuid, n); }
        return n;
    }

    constructor(
        private readonly session: MudSession,
        private readonly aliasEngine: AliasEngine,
        private readonly triggerEngine: TriggerEngine,
        private readonly timerEngine: TimerEngine,
        private readonly keyEngine: KeyEngine,
        connectionId: string,
        connectionName = '',
        private readonly proxyUrlGetter: () => string | undefined = () => undefined,
    ) {
        this.api = new ScriptingAPI(session, aliasEngine, triggerEngine, timerEngine, keyEngine);
        this.api.profileName = connectionName;
        this.connectionId = connectionId;
        this.bridgeEvents(session);
        // Let WindowManager raise system events (e.g. sysUserWindowResizeEvent)
        // through the same path as everything else.
        session.windows.onRaiseEvent = (event, args) => this.raiseEvent(event, args);
        this.runtimeReady = this.initRuntime(connectionId);
        this.attachToStore(session);
    }

    /**
     * Subscribe to the appStore and apply diffs synchronously on every
     * mutation. Zustand fires subscribers synchronously inside `set()`, so a
     * UI action like `installPackage(...)` immediately propagates into the
     * Lua runtime — handlers register before the caller's next line runs.
     * That guarantee is what lets `notifyPackageInstalled` raise its event
     * right after the store update without a React commit in between.
     *
     * Covers all five entity types — scripts, aliases, triggers, timers,
     * keybindings — so the engine is the single owner of the
     * store-to-runtime mapping. The UI just dispatches store actions.
     *
     * The first apply is gated on `output.ready` because some scripts open
     * windows on load and the dock system needs to be wired up first.
     * Triggers additionally wait for the PCRE wasm via TriggerEngine.ready()
     * — patterns won't compile before that.
     */
    private attachToStore(session: MudSession): void {
        const start = () => {
            // Modules are loaded from disk on every profile open — XML on disk is the
            // source of truth, so we re-read each module's XML and replace its nodes
            // before any script/alias/trigger load runs against the store. This
            // happens before the subscription is attached, so the reload itself
            // doesn't trigger a write-back loop.
            this.reloadModulesFromVfs();

            this.applyScriptsFromStore();
            this.applyAliasesFromStore();
            this.applyTimersFromStore();
            this.applyKeybindingsFromStore();
            // sysLoadEvent fires once after the initial script load.
            // Map-open notification keeps map-aware scripts in sync if the
            // map is already visible at connection time.
            this.raiseEvent('sysLoadEvent');
            if (this.api.windows.isVisible('map')) this.mapOpen.notify();
            this.api.flushOutput();

            // Triggers need PCRE wasm; until that resolves, skip apply on
            // the initial pass and on subsequent store updates. Once ready,
            // apply whatever the store says now.
            void TriggerEngine.ready().then(() => {
                this.triggersReady = true;
                this.applyTriggersFromStore();
            });

            this.storeUnsub = useAppStore.subscribe((state, prevState) => {
                const id = this.connectionId;
                const scriptsChanged  = state.connectionScripts[id]      !== prevState.connectionScripts[id];
                const aliasesChanged  = state.connectionAliases[id]      !== prevState.connectionAliases[id];
                const timersChanged   = state.connectionTimers[id]       !== prevState.connectionTimers[id];
                const keysChanged     = state.connectionKeybindings[id]  !== prevState.connectionKeybindings[id];
                const triggersChanged = state.connectionTriggers[id]     !== prevState.connectionTriggers[id];
                const buttonsChanged  = state.connectionButtons[id]      !== prevState.connectionButtons[id];

                if (scriptsChanged) this.applyScriptsFromStore();
                if (aliasesChanged) this.applyAliasesFromStore();
                if (timersChanged)  this.applyTimersFromStore();
                if (keysChanged)    this.applyKeybindingsFromStore();
                if (this.triggersReady && triggersChanged) this.applyTriggersFromStore();

                // Sync-on-edit for modules: any tagged-node mutation schedules
                // a debounced XML rewrite for affected modules.
                if (scriptsChanged || aliasesChanged || timersChanged || keysChanged || triggersChanged || buttonsChanged) {
                    this.scheduleModuleSyncForChanges(state, prevState);
                }
            });
        };
        if (session.outputReady) {
            start();
        } else {
            this.unsubs.push(session.events.on('output.ready', start, { once: true }));
        }
    }

    /**
     * For each installed module, re-parse its on-disk XML and replace its tagged
     * nodes in the store. Errors are logged but don't abort the rest of profile
     * load — a corrupted module shouldn't take the whole session down.
     */
    private reloadModulesFromVfs(): void {
        const vfs = this.vfs;
        if (!vfs) return;
        const id = this.connectionId;
        const packages = useAppStore.getState().connectionPackages[id] ?? [];
        for (const pkg of packages) {
            if (pkg.kind !== 'module') continue;
            try {
                const data = reloadModuleFromVfs(pkg, vfs);
                useAppStore.getState().installPackage(id, pkg, data);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.api.printError(`[module] failed to reload "${pkg.name}": ${msg}`);
            }
        }
    }

    /**
     * Detect whether any node tagged with a sync-enabled module's name changed
     * between two store states; for each module that changed, schedule a
     * debounced write of its current XML to disk. Comparison is done per
     * collection so an unrelated change in another module doesn't cause a write.
     */
    private scheduleModuleSyncForChanges(state: ReturnType<typeof useAppStore.getState>, prevState: ReturnType<typeof useAppStore.getState>): void {
        const id = this.connectionId;
        const packages = state.connectionPackages[id] ?? [];
        const dirtyModules = packages.filter(p => p.kind === 'module' && p.sync);
        if (dirtyModules.length === 0) return;

        for (const pkg of dirtyModules) {
            const changed =
                hasTaggedSliceChanged(pkg.name, state.connectionScripts[id],     prevState.connectionScripts[id]) ||
                hasTaggedSliceChanged(pkg.name, state.connectionAliases[id],     prevState.connectionAliases[id]) ||
                hasTaggedSliceChanged(pkg.name, state.connectionTriggers[id],    prevState.connectionTriggers[id]) ||
                hasTaggedSliceChanged(pkg.name, state.connectionTimers[id],      prevState.connectionTimers[id]) ||
                hasTaggedSliceChanged(pkg.name, state.connectionKeybindings[id], prevState.connectionKeybindings[id]) ||
                hasTaggedSliceChanged(pkg.name, state.connectionButtons[id],     prevState.connectionButtons[id]);
            if (changed) this.queueModuleSync(pkg.name);
        }
    }

    private queueModuleSync(moduleName: string): void {
        const existing = this.moduleSyncTimers.get(moduleName);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.moduleSyncTimers.delete(moduleName);
            this.syncModuleToFile(moduleName).catch(err => {
                const msg = err instanceof Error ? err.message : String(err);
                this.api.printError(`[module] sync failed for "${moduleName}": ${msg}`);
            });
        }, ScriptingEngine.MODULE_SYNC_DEBOUNCE_MS);
        this.moduleSyncTimers.set(moduleName, timer);
    }

    /**
     * Write the current in-store nodes for a module back to its XML file on disk.
     * Used both by the auto-sync debounce and the "Sync to file" UI action.
     */
    async syncModuleToFile(moduleName: string): Promise<void> {
        const vfs = this.vfs;
        if (!vfs) throw new Error('no profile VFS available');
        const id = this.connectionId;
        const state = useAppStore.getState();
        const pkg = (state.connectionPackages[id] ?? []).find(p => p.name === moduleName);
        if (!pkg) throw new Error(`module not installed: ${moduleName}`);
        if (pkg.kind !== 'module') throw new Error(`not a module: ${moduleName}`);
        const path = moduleXmlAbsolutePath(pkg, vfs);
        if (!path) throw new Error(`module "${moduleName}" has no xmlPath`);

        const filterPkg = <T extends { packageName?: string }>(arr: T[] | undefined): T[] =>
            (arr ?? []).filter(n => n.packageName === moduleName);

        const xml = serializeMudletXml({
            scripts:  filterPkg(state.connectionScripts[id]),
            aliases:  filterPkg(state.connectionAliases[id]),
            triggers: filterPkg(state.connectionTriggers[id]),
            timers:   filterPkg(state.connectionTimers[id]),
            keys:     filterPkg(state.connectionKeybindings[id]),
            buttons:  filterPkg(state.connectionButtons[id]),
        }, moduleName);

        const parent = path.substring(0, path.lastIndexOf('/'));
        if (parent && !vfs.exists(parent)) vfs.mkdir(parent);
        vfs.writeFile(path, xml);
        await vfs.flush();
        this.raiseEvent('sysSyncOnModule', [moduleName]);
    }

    /**
     * Re-read a module's XML from disk and replace its tagged nodes in the store.
     * Pairs with the "Reload from file" UI action.
     */
    reloadModuleFromFile(moduleName: string): boolean {
        const vfs = this.vfs;
        if (!vfs) {
            this.api.printError('[module] no profile VFS available');
            return false;
        }
        const id = this.connectionId;
        const pkg = (useAppStore.getState().connectionPackages[id] ?? []).find(p => p.name === moduleName);
        if (!pkg || pkg.kind !== 'module') {
            this.api.printError(`[module] not a module: ${moduleName}`);
            return false;
        }
        try {
            const data = reloadModuleFromVfs(pkg, vfs);
            useAppStore.getState().installPackage(id, pkg, data);
            this.raiseEvent('sysReadModuleEvent', [moduleName]);
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.api.printError(`[module] reload failed for "${moduleName}": ${msg}`);
            return false;
        }
    }

    /** Toggle a module's sync flag. Updates the manifest in the store. */
    setModuleSync(moduleName: string, sync: boolean): void {
        const id = this.connectionId;
        useAppStore.getState().updatePackageManifest(id, moduleName, { sync });
    }

    /** Read a module's sync flag. Returns false if the package isn't a module. */
    getModuleSync(moduleName: string): boolean {
        const pkg = this.findManifest(moduleName);
        return pkg?.kind === 'module' && !!pkg.sync;
    }

    /**
     * Set a module's load priority. Negative values cause its scripts to load
     * before profile scripts on the next full reload. The priority is metadata
     * only — changing it doesn't re-run anything; the new order takes effect on
     * the next profile open or explicit reload.
     */
    setModulePriority(moduleName: string, priority: number): boolean {
        const pkg = this.findManifest(moduleName);
        if (pkg?.kind !== 'module') return false;
        const p = Math.trunc(Number(priority) || 0);
        useAppStore.getState().updatePackageManifest(this.connectionId, moduleName, { priority: p });
        return true;
    }

    /** Read a module's load priority (default 0). Returns 0 for non-modules. */
    getModulePriority(moduleName: string): number {
        const pkg = this.findManifest(moduleName);
        if (pkg?.kind !== 'module') return 0;
        return pkg.priority ?? 0;
    }

    /** List installed module names. Order matches install order. */
    getModuleNames(): string[] {
        const packages = useAppStore.getState().connectionPackages[this.connectionId] ?? [];
        return packages.filter(p => p.kind === 'module').map(p => p.name);
    }

    /** Snapshot of a module's manifest, or null if not installed / not a module. */
    getModuleInfo(moduleName: string): PackageManifest | null {
        const pkg = this.findManifest(moduleName);
        return pkg?.kind === 'module' ? { ...pkg } : null;
    }

    /**
     * Install a module from a path inside the profile VFS. Plain XML stays in
     * place (manifest holds the absolute VFS path). Zips/.mpackages extract into
     * the standard pkgDir. Raises sysInstall, sysInstallPackage and
     * sysInstallModule on success — sysInstallModule is the module-specific
     * counterpart to sysInstallPackage.
     */
    installModuleFromPath(path: string): boolean {
        const vfs = this.vfs;
        if (!vfs) {
            this.api.printError('[installModule] no profile VFS available');
            return false;
        }
        try {
            const { manifest, data } = installModuleFromVfsPath(path, vfs);
            useAppStore.getState().installPackage(this.connectionId, manifest, data);
            this.notifyPackageInstalled(manifest.name);
            this.raiseEvent('sysInstallModule', [manifest.name]);
            void vfs.flush();
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.api.printError(`[installModule] ${msg}`);
            return false;
        }
    }

    /**
     * Uninstall a module by name. Refuses to act on regular packages so callers
     * can keep installPackage/uninstallPackage and installModule/uninstallModule
     * cleanly separated. Modules unlink — the on-disk XML is left in place.
     */
    uninstallModuleByName(moduleName: string): boolean {
        const pkg = this.findManifest(moduleName);
        if (pkg?.kind !== 'module') {
            this.api.printError(`[uninstallModule] not a module: ${moduleName}`);
            return false;
        }
        this.notifyPackageUninstalled(moduleName);
        this.raiseEvent('sysUninstallModule', [moduleName]);
        useAppStore.getState().uninstallPackage(this.connectionId, moduleName);
        if (this.vfs) {
            const vfs = this.vfs;
            void uninstallPackageFiles(pkg, vfs).catch(err => {
                console.warn('[ScriptingEngine] failed to remove module files:', err);
            });
        }
        return true;
    }

    private findManifest(name: string): PackageManifest | undefined {
        return (useAppStore.getState().connectionPackages[this.connectionId] ?? []).find(p => p.name === name);
    }

    private applyAliasesFromStore(): void {
        const aliases = useAppStore.getState().connectionAliases[this.connectionId] ?? [];
        this.aliasEngine.loadPerm(aliases);
    }

    private applyTriggersFromStore(): void {
        const triggers = useAppStore.getState().connectionTriggers[this.connectionId] ?? [];
        this.triggerEngine.loadPerm(triggers);
    }

    private applyTimersFromStore(): void {
        const timers = useAppStore.getState().connectionTimers[this.connectionId] ?? [];
        this.timerEngine.loadPerm(timers, (timer) => {
            if (timer.command) this.api.send(timer.command, false);
            if (timer.code && timer.language === 'lua') {
                try {
                    this.runtimes.lua?.run(timer.code, `timer "${timer.name}"`);
                } catch (err) {
                    this.reportEntityError('timer', timer.id, timer.name, err);
                }
            }
            this.api.flushOutput();
        });
    }

    private applyKeybindingsFromStore(): void {
        const keys = useAppStore.getState().connectionKeybindings[this.connectionId] ?? [];
        this.keyEngine.loadPerm(keys);
    }

    private applyScriptsFromStore(): void {
        const next = useAppStore.getState().connectionScripts[this.connectionId] ?? [];
        const prev = this.prevScripts;
        this.prevScripts = next;
        if (prev === next) return;

        const prevEnabled = new Map(
            prev.filter(s => s.language === 'lua' && isEffectivelyEnabled(s, prev))
                .map(s => [s.id, s] as const),
        );
        const nextEnabledIds = new Set(
            next.filter(s => s.language === 'lua' && isEffectivelyEnabled(s, next))
                .map(s => s.id),
        );
        for (const id of prevEnabled.keys()) {
            if (!nextEnabledIds.has(id)) this.unloadScript(id);
        }
        // Mudlet-style module load priority: scripts owned by modules with a
        // negative priority load before profile scripts; non-negative priorities
        // load after. Within a priority bucket, original array order is preserved
        // so existing trees stay deterministic. Profile-owned scripts (no
        // packageName) are treated as priority 0.
        const priorityMap = this.modulePriorityMap();
        const orderedNext = next
            .map((s, idx) => ({ s, idx, prio: priorityFor(s, priorityMap) }))
            .sort((a, b) => a.prio - b.prio || a.idx - b.idx);
        for (const { s } of orderedNext) {
            if (s.language !== 'lua' || !isEffectivelyEnabled(s, next)) continue;
            const was = prevEnabled.get(s.id);
            const handlersChanged = !!was && was.eventHandlers.join('\n') !== s.eventHandlers.join('\n');
            if (!was || was.code !== s.code || handlersChanged) {
                this.reloadScript(s);
            }
        }
    }

    /** Map of module name → priority. Profile (no packageName) is implicitly 0. */
    private modulePriorityMap(): Map<string, number> {
        const map = new Map<string, number>();
        const packages = useAppStore.getState().connectionPackages[this.connectionId] ?? [];
        for (const p of packages) {
            if (p.kind === 'module') map.set(p.name, p.priority ?? 0);
        }
        return map;
    }

    private initRuntime(connectionId: string): Promise<IScriptingRuntime> {
        return ProfileVFS.mount(connectionId).then(
            vfs  => {
                this.vfs = vfs;
                registerVfs(connectionId, vfs);
                return this.createRuntime(vfs);
            },
            err  => {
                console.error('[ScriptingEngine] VFS mount failed:', err);
                this.api.printError(`[scripting] VFS mount failed: ${err instanceof Error ? err.message : String(err)}`);
                return this.createRuntime(null);
            },
        );
    }

    private createRuntime(vfs: ProfileVFS | null): Promise<IScriptingRuntime> {
        return LuaRuntime.create(this.api, vfs, this.proxyUrlGetter).then(rt => {
            this.runtimes.lua = rt;
            this.api.setExecuteScript((code) => {
                const lua = this.runtimes.lua;
                if (!lua) return;
                try {
                    lua.run(code, 'link');
                } catch (err) {
                    this.api.printError(`[link] ${err instanceof Error ? err.message : String(err)}`);
                }
                this.api.flushOutput();
            });
            this.api.setExpandAlias((text, echo) => {
                if (!this.processInput(text)) this.api.send(text, echo);
            });
            this.api.setSendRequestDispatcher((text) =>
                this.runtimes.lua?.dispatchSendRequest(text) ?? false);
            this.api.setEventRaiser((event, args) => this.raiseEvent(event, args));
            this.api.setFeedDispatcher((groups) => this.processFlushBatch(groups));
            this.api.setPackageInstaller((path) => this.installPackageFromVfsPath(path));
            this.api.setPackageUninstaller((name) => this.uninstallPackageByName(name));
            this.api.setPackagesGetter(() =>
                (useAppStore.getState().connectionPackages[this.connectionId] ?? []).map(p => p.name));
            this.api.setModuleInstaller((path) => this.installModuleFromPath(path));
            this.api.setModuleUninstaller((name) => this.uninstallModuleByName(name));
            this.api.setModuleSyncer((name) => this.syncModuleToFile(name));
            this.api.setModuleReloader((name) => this.reloadModuleFromFile(name));
            this.api.setModuleSyncSetter((name, sync) => this.setModuleSync(name, sync));
            this.api.setModuleSyncGetter((name) => this.getModuleSync(name));
            this.api.setModulePrioritySetter((name, p) => this.setModulePriority(name, p));
            this.api.setModulePriorityGetter((name) => this.getModulePriority(name));
            this.api.setModulesGetter(() => this.getModuleNames());
            this.api.setModuleInfoGetter((name) => {
                const info = this.getModuleInfo(name);
                return info ? (info as unknown as Record<string, unknown>) : null;
            });
            this.api.setScriptToggler((name, enabled) => this.toggleScriptByName(name, enabled));
            this.api.setTriggerToggler((name, enabled) => this.toggleTriggerByName(name, enabled));
            this.api.setTimerToggler((name, enabled) => this.toggleTimerByName(name, enabled));
            this.api.setExistsCallback((name, type) => this.existsByName(name, type));
            this.api.setPermScriptCallback((name, parent, code) => this.createPermScript(name, parent, code));
            this.api.setPermRegexTriggerCallback((name, parent, regexes, code) => this.createPermRegexTrigger(name, parent, regexes, code));
            this.api.setSetScriptCallback((name, code, pos) => this.setScriptByName(name, code, pos));
            this.api.setKillByNameCallback((kind, name) => this.killByName(kind, name));
            this.api.setCssRewriter((css) => {
                const v = this.vfs;
                if (!v) return css;
                return rewriteVfsUrlsInCss(css, this.connectionId, v);
            });
            this.triggerEngine.setLuaEval((code) => {
                const lua = this.runtimes.lua;
                return lua ? lua.evalTriggerPattern(code) : false;
            });
            return rt;
        }).catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[ScriptingEngine] Lua runtime init failed:', err);
            this.api.printError(`[scripting] Lua runtime init failed: ${msg}`);
            throw err;
        });
    }

    /**
     * Tear down a script's event-handler registrations. Used when a script is
     * removed or transitions enabled→disabled so its handlers stop firing
     * before the next full runtime reload.
     *
     * Runs synchronously once the runtime is up so the store-subscription
     * pipeline (script removed → handlers gone) completes inside the same
     * tick as the store mutation. See attachToStore for the rationale.
     */
    unloadScript(scriptId: string): void {
        const rt = this.runtimes.lua;
        if (rt) { rt.killScriptHandlers(scriptId); return; }
        this.runtimeReady.then(rt => rt.killScriptHandlers(scriptId)).catch(() => {});
    }

    /**
     * Raise sysInstall / sysInstallPackage. The caller is expected to have
     * just committed the package's items to the appStore — our subscription
     * loads the new scripts synchronously inside that commit, so by the time
     * this method runs the package's event handlers are already registered.
     */
    notifyPackageInstalled(packageName: string): void {
        this.raiseEvent('sysInstall', [packageName]);
        this.raiseEvent('sysInstallPackage', [packageName]);
    }

    /**
     * Raise sysUninstall / sysUninstallPackage. Call this BEFORE removing the
     * package's items from the store so the package's own handlers (and the
     * scripts they live in) are still loaded when the event fires.
     */
    notifyPackageUninstalled(packageName: string): void {
        this.raiseEvent('sysUninstall', [packageName]);
        this.raiseEvent('sysUninstallPackage', [packageName]);
    }

    /**
     * Install a package from a path inside the VFS. Reads the bytes synchronously,
     * commits to the store (which loads scripts into Lua synchronously via the
     * store subscription), then raises sysInstallPackage. The disk flush happens
     * in the background. Returns false on any failure (file missing, parse error,
     * etc.) and prints a script-log error.
     */
    installPackageFromVfsPath(path: string): boolean {
        const vfs = this.vfs;
        if (!vfs) {
            this.api.printError(`[installPackage] no profile VFS available`);
            return false;
        }
        if (!vfs.exists(path)) {
            this.api.printError(`[installPackage] file not found: ${path}`);
            return false;
        }
        try {
            const buf = vfs.readBinaryFile(path);
            const filename = path.split('/').pop() || path;
            const { manifest, data } = installPackageFromBytes(filename, buf, vfs);
            useAppStore.getState().installPackage(this.connectionId, manifest, data);
            this.notifyPackageInstalled(manifest.name);
            void vfs.flush();
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.api.printError(`[installPackage] ${msg}`);
            return false;
        }
    }

    /**
     * Uninstall a previously installed package by name. Raises sysUninstallPackage
     * before the store removal so the package's own handlers can still run.
     * Removes the on-disk package directory in the background.
     */
    uninstallPackageByName(packageName: string): boolean {
        const installed = useAppStore.getState().connectionPackages[this.connectionId] ?? [];
        const manifest = installed.find(p => p.name === packageName);
        if (!manifest) {
            this.api.printError(`[uninstallPackage] package not installed: ${packageName}`);
            return false;
        }
        this.notifyPackageUninstalled(packageName);
        useAppStore.getState().uninstallPackage(this.connectionId, packageName);
        if (this.vfs) {
            const vfs = this.vfs;
            void uninstallPackageFiles(manifest, vfs).catch(err => {
                console.warn('[ScriptingEngine] failed to remove package files:', err);
            });
        }
        return true;
    }

    /**
     * Toggle a script's enabled flag by name (Mudlet enableScript/disableScript).
     * The store subscription picks up the change synchronously and either loads
     * or unloads handlers in the runtime.
     */
    toggleScriptByName(name: string, enabled: boolean): boolean {
        const store = useAppStore.getState();
        const scripts = store.connectionScripts[this.connectionId] ?? [];
        const target = scripts.find(s => s.name === name);
        if (!target) return false;
        if (target.enabled === enabled) return true;
        store.updateScript(this.connectionId, target.id, { enabled });
        return true;
    }

    /**
     * Toggle triggers' enabled flag by name (Mudlet enableTrigger/disableTrigger).
     * Mudlet matches every trigger or group sharing the name, so we do the same:
     * toggling a group cascades to children via isEffectivelyEnabled. The store
     * subscription rebuilds the compiled trigger set on the next tick.
     */
    toggleTriggerByName(name: string, enabled: boolean): boolean {
        const store = useAppStore.getState();
        const triggers = store.connectionTriggers[this.connectionId] ?? [];
        const targets = triggers.filter(t => t.name === name);
        if (targets.length === 0) return false;
        for (const t of targets) {
            if (t.enabled !== enabled) store.updateTrigger(this.connectionId, t.id, { enabled });
        }
        return true;
    }

    /**
     * Toggle timers' enabled flag by name (Mudlet enableTimer/disableTimer).
     * Mirrors toggleTriggerByName: every timer or group sharing the name is
     * affected, and the store subscription rebuilds the active timer set.
     */
    toggleTimerByName(name: string, enabled: boolean): boolean {
        const store = useAppStore.getState();
        const timers = store.connectionTimers[this.connectionId] ?? [];
        const targets = timers.filter(t => t.name === name);
        if (targets.length === 0) return false;
        for (const t of targets) {
            if (t.enabled !== enabled) store.updateTimer(this.connectionId, t.id, { enabled });
        }
        return true;
    }

    /**
     * Mudlet `exists(nameOrId, type)`. With a name string, returns the count of
     * items matching the name in the named collection. With a numeric id, looks
     * up the perm item by its monotonic id (the one permScript/permRegexTrigger
     * etc. return) and reports 1 if it lives in the matching collection, else 0.
     * Type aliases follow Mudlet: "key" and "keybind" both target keybindings.
     * Unknown types return 0.
     */
    existsByName(nameOrId: string | number, type: string): number {
        const store = useAppStore.getState();
        const id = this.connectionId;
        const list = ((): { id: string; name: string }[] => {
            switch (type) {
                case 'alias':   return store.connectionAliases[id]      ?? [];
                case 'trigger': return store.connectionTriggers[id]     ?? [];
                case 'timer':   return store.connectionTimers[id]       ?? [];
                case 'key':
                case 'keybind': return store.connectionKeybindings[id]  ?? [];
                case 'button':  return store.connectionButtons[id]      ?? [];
                case 'script':  return store.connectionScripts[id]      ?? [];
                default:        return [];
            }
        })();
        if (typeof nameOrId === 'number' && Number.isFinite(nameOrId)) {
            const wanted = nameOrId;
            for (const item of list) {
                const n = this.uuidToNumericId.get(item.id);
                if (n !== undefined && n === wanted) return 1;
            }
            return 0;
        }
        const name = String(nameOrId);
        return list.filter(i => i.name === name).length;
    }

    /**
     * Mudlet `permScript(name, parent, luaCode)`. Creates a saved Lua script
     * named `name` under the script group `parent` (empty = root). Returns the
     * new script's id on success, -1 if `parent` is given but no script group
     * with that name exists. The store subscription loads the script's
     * handlers synchronously inside the addScript commit.
     */
    createPermScript(name: string, parent: string, code: string): number {
        if (!name) return -1;
        const store = useAppStore.getState();
        const scripts = store.connectionScripts[this.connectionId] ?? [];
        let parentId: string | null = null;
        if (parent && parent.length > 0) {
            const group = scripts.find(s => s.isGroup && s.name === parent);
            if (!group) return -1;
            parentId = group.id;
        }
        const uuid = store.addScript(this.connectionId, {
            name,
            enabled: true,
            isGroup: false,
            parentId,
            code,
            language: 'lua',
            eventHandlers: [],
        });
        return this.numericIdFor(uuid);
    }

    /**
     * Mudlet `permRegexTrigger(name, parent, regexes, luaCode)`. Creates a saved
     * trigger named `name` under the trigger group `parent` (empty = root) with
     * one or more regex patterns; matches fire OR-style. An empty `regexes` table
     * creates a trigger group instead — matches the convention `permGroup` uses
     * to bootstrap folders. Returns the new trigger's id, or -1 if `parent` is
     * given but no trigger group with that name exists.
     */
    createPermRegexTrigger(name: string, parent: string, regexes: string[], code: string): number {
        if (!name) return -1;
        const store = useAppStore.getState();
        const triggers = store.connectionTriggers[this.connectionId] ?? [];
        let parentId: string | null = null;
        if (parent && parent.length > 0) {
            const group = triggers.find(t => t.isGroup && t.name === parent);
            if (!group) return -1;
            parentId = group.id;
        }
        const isGroup = regexes.length === 0;
        const patterns: TriggerNode['patterns'] = regexes.map(r => ({ type: 'regex', text: r }));
        const uuid = store.addTrigger(this.connectionId, {
            name,
            enabled: true,
            isGroup,
            parentId,
            patterns,
            code,
            language: 'lua',
            fireLength: 0,
            multipleMatches: false,
            multiline: false,
            delta: 0,
            isFilter: false,
        });
        return this.numericIdFor(uuid);
    }

    /**
     * Mudlet `setScript(name, luaCode[, pos])`. Replaces the source of the
     * `pos`-th script (1-indexed; default 1) named `name`. Updating via the
     * store re-runs the script load through the regular subscription pipeline,
     * so handlers re-register cleanly. Returns true on success, -1 if no such
     * script exists.
     */
    setScriptByName(name: string, code: string, pos: number): number {
        if (!name) return -1;
        const store = useAppStore.getState();
        const scripts = store.connectionScripts[this.connectionId] ?? [];
        const matches = scripts.filter(s => s.name === name);
        const index = Math.max(1, Math.floor(pos)) - 1;
        const target = matches[index];
        if (!target) return -1;
        store.updateScript(this.connectionId, target.id, { code });
        return this.numericIdFor(target.id);
    }

    /**
     * Mudlet `killTimer/killAlias/killTrigger/killKey(name)` deletes every
     * permanent item sharing the given name. Returns true if at least one was
     * removed. Mirrors `toggleTriggerByName`'s "all matches" semantics so
     * groups and their sibling-named items vanish together. The store
     * subscription tears down the runtime side (timers stop firing, triggers
     * recompile) on the next tick.
     */
    killByName(kind: 'timer' | 'alias' | 'trigger' | 'key', name: string): boolean {
        if (!name) return false;
        const store = useAppStore.getState();
        const id = this.connectionId;
        switch (kind) {
            case 'timer': {
                const targets = (store.connectionTimers[id] ?? []).filter(t => t.name === name);
                if (targets.length === 0) return false;
                for (const t of targets) store.removeTimer(id, t.id);
                return true;
            }
            case 'alias': {
                const targets = (store.connectionAliases[id] ?? []).filter(t => t.name === name);
                if (targets.length === 0) return false;
                for (const t of targets) store.removeAlias(id, t.id);
                return true;
            }
            case 'trigger': {
                const targets = (store.connectionTriggers[id] ?? []).filter(t => t.name === name);
                if (targets.length === 0) return false;
                for (const t of targets) store.removeTrigger(id, t.id);
                return true;
            }
            case 'key': {
                const targets = (store.connectionKeybindings[id] ?? []).filter(t => t.name === name);
                if (targets.length === 0) return false;
                for (const t of targets) store.removeKeybinding(id, t.id);
                return true;
            }
        }
    }

    /**
     * Run a single script on the existing runtime without restarting it.
     *
     * Runs synchronously when the runtime is already up. That sync path is
     * load-bearing: notifyPackageInstalled raises sysInstallPackage right
     * after applyScriptsFromStore returns, and the package's own event
     * handlers (and the function `_G[scriptName]` they dispatch to) must be
     * defined by then. An `await` here — even on an already-resolved promise
     * — would defer the load to a microtask and the event would fire against
     * an empty handler set.
     */
    reloadScript(script: ScriptNode): void {
        if (script.language !== 'lua' || !script.code) return;
        const rt = this.runtimes.lua;
        if (rt) { this.runScriptLoad(rt, script); return; }
        this.runtimeReady.then(rt => this.runScriptLoad(rt, script)).catch(() => {});
    }

    private runScriptLoad(rt: IScriptingRuntime, script: ScriptNode): void {
        try {
            rt.load(this.wrapScript(script), script.name);
        } catch (err) {
            this.reportEntityError('script', script.id, script.name, err);
        }
        this.api.flushOutput();
    }

    get currentVFS(): ProfileVFS | null { return this.vfs; }

    /**
     * Send a command from the command bar. Raises sysDataSendRequest, then either
     * sends (and echoes locally) or aborts when a handler calls denyCurrentSend().
     */
    sendCommand(text: string): void {
        this.api.send(text, true);
    }

    /** Run input through aliases. Returns true if an alias matched (caller should not send). */
    processInput(text: string): boolean {
        // setCmdLineAction takes the whole Enter event; aliases and the MUD
        // send are bypassed when an action is installed (matches Mudlet — the
        // script owns the command bar end-to-end). Errors in the action are
        // routed through printError and still consume the input so the bare
        // text isn't silently sent.
        const action = this.api.getCmdLineAction();
        if (action) {
            try { action(text); }
            catch (e) { this.api.printError(`[setCmdLineAction] ${e instanceof Error ? e.message : String(e)}`); }
            this.api.flushOutput();
            return true;
        }
        // JS temp aliases
        if (this.aliasEngine.processTemp(text)) {
            this.api.flushOutput();
            return true;
        }
        // Permanent aliases
        const permMatch = this.aliasEngine.matchPerm(text);
        if (permMatch) {
            this.executePermAlias(permMatch.alias, [text, ...permMatch.captures]);
            this.api.flushOutput();
            return true;
        }
        this.api.flushOutput();
        return false;
    }

    /** Process a keyboard event. Returns true if a keybinding consumed it. */
    processKey(event: KeyboardEvent): boolean {
        // JS temp keybindings
        if (this.keyEngine.processTemp(event)) {
            this.api.flushOutput();
            return true;
        }
        // Permanent keybindings
        const permMatch = this.keyEngine.matchPerm(event);
        if (permMatch) {
            this.executePermKeybinding(permMatch);
            this.api.flushOutput();
            return true;
        }
        this.api.flushOutput();
        return false;
    }

    raiseEvent(event: string, args: unknown[] = []): void {
        this.emit(event, args);
    }

    notifyMapOpen(): void {
        this.mapOpen.notify();
    }

    destroy(): void {
        for (const t of this.moduleSyncTimers.values()) clearTimeout(t);
        this.moduleSyncTimers.clear();
        this.storeUnsub?.();
        this.storeUnsub = null;
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
        this.session.windows.onRaiseEvent = undefined;
        this.runtimes.lua?.destroy();
        this.runtimes.lua = null;
        this.triggerEngine.setLuaEval(null);
        this.api.setExecuteScript(null);
        this.api.setExpandAlias(null);
        this.api.setSendRequestDispatcher(null);
        this.api.setCssRewriter(null);
        this.api.destroy();
        const oldVfs = this.vfs;
        this.vfs = null;
        unregisterVfs(this.connectionId);
        // Drain any pending writes (folder-backed VFS uses async write-through);
        // the unmount tears down the in-memory cache so stale dirty state would
        // otherwise be lost. Fire-and-forget — destroy is sync and we don't want
        // to block teardown on a slow disk write.
        oldVfs?.flush().finally(() => oldVfs.unmount());
    }

    // Tag a Lua error with the source entity (kind + id + name + line) so the
    // error log can render a jump-to-source button. `printError` forwards the
    // source through the script.log event into the session buffer.
    private reportEntityError(
        kind: ScriptLogSourceKind,
        id: string,
        name: string,
        err: unknown,
    ): void {
        const msg = err instanceof Error ? err.message : String(err);
        const source: ScriptLogSource = { kind, id, name };
        const line = parseLuaErrorLine(msg);
        if (line !== undefined) source.line = line;
        this.api.printError(`[${formatErrorPrefix(kind, name)}] ${msg}`, source);
    }

    // Mudlet TScript semantics: the body runs at load time (defining e.g.
    // `function MyScript(event, ...) ... end` as a global), and each event
    // handler fires by looking up the global named after the script and
    // calling it. We dispatch via _G[name] (not a direct function reference)
    // so re-saving the script picks up the new function, and so missing/
    // mistyped function names silently no-op like Mudlet.
    //
    // The wrapper also kills any previously-registered handlers for this
    // script (Bridge.lua's __mudix_script_handlers tracks IDs by script id)
    // so re-saving doesn't accumulate duplicate registrations.
    private wrapScript(script: ScriptNode): string {
        if (script.eventHandlers.length === 0) return script.code;
        const sidLiteral = JSON.stringify(script.id);
        const nameLiteral = JSON.stringify(script.name);
        const registrations = script.eventHandlers
            .map(e =>
                `__mudix_script_handlers[${sidLiteral}][#__mudix_script_handlers[${sidLiteral}]+1] = ` +
                `registerAnonymousEventHandler(${JSON.stringify(e)}, function(...) ` +
                `local __fn = _G[${nameLiteral}]; ` +
                `if type(__fn) == 'function' then return __fn(...) end ` +
                `end)`)
            .join('\n');
        return [
            `__mudix_kill_script_handlers(${sidLiteral})`,
            `__mudix_script_handlers[${sidLiteral}] = {}`,
            script.code,
            registrations,
        ].join('\n');
    }

    private executePermAlias(alias: AliasNode, matches: string[]): void {
        if (alias.command) {
            const cmd = alias.command.replace(/%(\d)/g, (_, d) => {
                const idx = Number(d);
                return idx === 0 ? matches[0] : (matches[idx] ?? '');
            });
            this.api.send(cmd);
        }
        if (alias.code && alias.language === 'lua') {
            try {
                this.runtimes.lua?.runWithMatches(alias.code, alias.name, matches);
            } catch (err) {
                this.reportEntityError('alias', alias.id, alias.name, err);
            }
        }
    }

    private executePermTrigger(
        trigger: TriggerNode,
        matches: string[],
        matchedText: string,
        multimatches?: string[][],
        namedGroups?: Record<string, string>,
        captureSpans?: { start: number; length: number }[],
        namedSpans?: Record<string, { start: number; length: number }>,
    ): void {
        // Built-in command send
        if (trigger.command) {
            const cmd = trigger.command.replace(/%(\d)/g, (_, d) => {
                const idx = Number(d);
                return idx === 0 ? matches[0] : (matches[idx] ?? '');
            });
            this.api.send(cmd, false);
        }

        // Built-in highlight
        if (trigger.highlight && matchedText) {
            const { fg, bg } = trigger.highlight;
            if (fg || bg) {
                const idx = this.api.selectString(matchedText, 1);
                if (idx >= 0) {
                    const fgColor = fg ? hexToRgb(fg) : null;
                    const bgColor = bg ? hexToRgb(bg) : null;
                    if (fgColor || bgColor) {
                        this.api.applyFormatToSelection({
                            ...(fgColor ? { foreground: fgColor } : {}),
                            ...(bgColor ? { background: bgColor } : {}),
                        });
                    }
                    this.api.deselect();
                }
            }
        }

        // User code
        if (trigger.code && trigger.language === 'lua') {
            try {
                this.runtimes.lua?.runWithMatches(
                    trigger.code, trigger.name, matches, multimatches, namedGroups, captureSpans, namedSpans);
            } catch (err) {
                this.reportEntityError('trigger', trigger.id, trigger.name, err);
            }
        }
    }

    private executePermKeybinding(binding: KeyNode): void {
        if (binding.command) this.api.send(binding.command, false);
        if (binding.code && binding.language === 'lua') {
            try {
                this.runtimes.lua?.run(binding.code, `key "${binding.name}"`);
            } catch (err) {
                this.reportEntityError('key', binding.id, binding.name, err);
            }
        }
    }

    /**
     * Run a button's command + code. The Lua `code` runs on every click.
     * For two-state buttons, `nextState=true` (going DOWN) sends `commandDown`,
     * otherwise (going UP, or single-state click) sends `command`.
     */
    executeButton(button: ButtonNode, nextState: boolean): void {
        const goingDown = button.isPushDown && nextState;
        const cmd = goingDown ? button.commandDown : button.command;
        if (cmd) this.api.send(cmd, false);
        if (button.code && button.language === 'lua') {
            try {
                this.runtimes.lua?.run(button.code, `button "${button.name}"`);
            } catch (err) {
                this.reportEntityError('button', button.id, button.name, err);
            }
        }
        this.api.flushOutput();
    }

    /**
     * Run a flushLines batch end-to-end: triggers, rendering, then deferred-echo
     * flush. Shared between the network-driven flushLines listener and the
     * scripting `feedTriggers` API so both paths preserve identical semantics
     * (line ordering, ANSI carry, trigger-echo placement).
     */
    private processFlushBatch(groups: { text: string; type: string }[]): void {
        for (const { text, type } of groups) {
            try {
                const lines = text.split('\n');
                if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

                let carryState: FormatStateSnapshot | undefined;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const plain = line.replace(ANSI_RE, '');
                    const isPrompt = this.promptPending && i === lines.length - 1;
                    if (isPrompt) this.promptPending = false;

                    const buffer = new AnsiAwareBuffer(line, carryState);
                    carryState = buffer.trailingState();

                    if (plain.length > 0) {
                        this.processLineTriggers(plain, buffer, isPrompt);
                        this.emit('output', [line, type]);
                    }

                    const shouldRender =
                        !buffer.deleted &&
                        (line === '' || plain.length > 0 || !FILTER_ANSI_ONLY_LINES);
                    if (shouldRender) {
                        this.session.events.emit('message', buffer, type, Date.now());
                    }
                }
            } finally {
                // Flush trigger echoes after the group renders so they never
                // interleave with the batch. `finally` guarantees isDeferringEcho
                // is reset even if processing throws.
                this.api.flushDeferredEcho();
            }
        }
    }

    /**
     * Run all triggers against `plain` (the original ANSI-stripped text).
     * Trigger handlers that call selectString/fg/bg/deleteLine modify `buffer`
     * in-place. The buffer is NOT rendered here — the caller renders it after
     * this returns, so the final rendered line already has all colorization.
     *
     * echo/cecho output from trigger handlers is deferred (via ScriptingAPI)
     * and flushed after all lines in the batch are rendered.
     */
    private processLineTriggers(plain: string, buffer: AnsiAwareBuffer, isPrompt = false): void {
        this.api.beginLine(buffer);
        try {
            this.runtimes.lua?.setCurrentLine(plain, isPrompt);
            this.triggerEngine.processTemp(plain);
            const matches = this.triggerEngine.matchPerm(plain, isPrompt);
            for (const m of matches) {
                this.executePermTrigger(
                    m.trigger,
                    [plain, ...m.captures],
                    m.matchedText,
                    m.multimatches,
                    m.namedGroups,
                    m.captureSpans,
                    m.namedSpans,
                );
            }
        } finally {
            this.api.endLine();
        }
    }

    private emit(event: string, args: unknown[]): void {
        try {
            this.runtimes.lua?.emitEvent(event, args);
        } catch (err) {
            this.api.printError(`[event "${event}"] ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private bridgeEvents(session: MudSession): void {
        this.unsubs.push(
            session.events.on('prompt', () => {
                this.promptPending = true;
            }),
            session.events.on('flushLines', (groups) => {
                try {
                    this.processFlushBatch(groups);
                } catch (err) {
                    this.api.printError(`[scripting] line flush failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }),
            session.events.on('client.connect', () => this.emit('connect', [])),
            session.events.on('client.disconnect', () => this.emit('disconnect', [])),
            session.events.on('gmcp', ({ path, value }) => {
                console.log('[gmcp]', path, value);
                this.api.updateGmcp(path, value);
                this.emit('gmcp', [path, value]);
            }),
            // Package install/uninstall events are dispatched by callers via
            // notifyPackageInstalled / notifyPackageUninstalled (not the
            // session event bus) so we can sequence the script-load before
            // sysInstallPackage fires. See those methods for rationale.
        );
    }
}
