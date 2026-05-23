import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { APP_DEFAULTS, type AppSchema, type MudConnection, type AliasNode, type ButtonNode, type KeyNode, type TimerNode, type TriggerNode, type ScriptNode, type ScriptEditorBounds, type ModalBounds, type ClientSettings, type ProfileSettings, type PackageManifest } from './schema';
import type { MudletImportResult } from '../import/mudletXmlImport';
import type { WindowOpenOptions } from '../ui/windows/types';
import { createDebouncedJsonStorage } from './debouncedStorage';

function getDescendantIds(id: string, items: { id: string; parentId: string | null }[]): string[] {
    const result: string[] = [];
    const queue = [id];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const item of items) {
            if (item.parentId === current) {
                result.push(item.id);
                queue.push(item.id);
            }
        }
    }
    return result;
}

/** Moves item `id` (and its whole subtree) to a new parent, inserting before `insertBeforeId`. */
function moveInList<T extends { id: string; parentId: string | null }>(
    items: T[],
    id: string,
    newParentId: string | null,
    insertBeforeId: string | null,
): T[] {
    const subtreeIds = new Set([id, ...getDescendantIds(id, items)]);
    const subtree = items.filter(i => subtreeIds.has(i.id));
    const rest = items.filter(i => !subtreeIds.has(i.id));
    const moved = subtree.map(i => i.id === id ? { ...i, parentId: newParentId } : i);
    if (insertBeforeId === null) return [...rest, ...moved];
    const idx = rest.findIndex(i => i.id === insertBeforeId);
    if (idx === -1) return [...rest, ...moved];
    return [...rest.slice(0, idx), ...moved, ...rest.slice(idx)];
}

interface AppStore extends AppSchema {
    addConnection: (data: Omit<MudConnection, 'id'>) => void;
    updateConnection: (id: string, data: Omit<MudConnection, 'id'>) => void;
    removeConnection: (id: string) => void;
    patchClient: (patch: Partial<ClientSettings>) => void;
    patchConnectionProfile: (connectionId: string, patch: Partial<ProfileSettings>) => void;
    saveWindowHint: (connectionId: string, panelId: string, hint: WindowOpenOptions) => void;
    clearWindowHints: (connectionId: string) => void;
    saveDockExtents: (connectionId: string, extents: Record<string, number>) => void;
    addScript: (connectionId: string, data: Omit<ScriptNode, 'id'>) => string;
    updateScript: (connectionId: string, id: string, patch: Partial<Omit<ScriptNode, 'id'>>) => void;
    removeScript: (connectionId: string, id: string) => void;
    addAlias: (connectionId: string, data: Omit<AliasNode, 'id'>) => string;
    updateAlias: (connectionId: string, id: string, patch: Partial<Omit<AliasNode, 'id'>>) => void;
    removeAlias: (connectionId: string, id: string) => void;
    addTrigger: (connectionId: string, data: Omit<TriggerNode, 'id'>) => string;
    updateTrigger: (connectionId: string, id: string, patch: Partial<Omit<TriggerNode, 'id'>>) => void;
    /** Bulk apply enabled/disabled (or any partial) to many triggers in one set(). */
    updateTriggers: (connectionId: string, patches: ReadonlyArray<{ id: string; patch: Partial<Omit<TriggerNode, 'id'>> }>) => void;
    removeTrigger: (connectionId: string, id: string) => void;
    removeTriggers: (connectionId: string, ids: ReadonlyArray<string>) => void;
    addTimer: (connectionId: string, data: Omit<TimerNode, 'id'>) => string;
    updateTimer: (connectionId: string, id: string, patch: Partial<Omit<TimerNode, 'id'>>) => void;
    updateTimers: (connectionId: string, patches: ReadonlyArray<{ id: string; patch: Partial<Omit<TimerNode, 'id'>> }>) => void;
    removeTimer: (connectionId: string, id: string) => void;
    removeTimers: (connectionId: string, ids: ReadonlyArray<string>) => void;
    removeAliases: (connectionId: string, ids: ReadonlyArray<string>) => void;
    addKeybinding: (connectionId: string, data: Omit<KeyNode, 'id'>) => string;
    updateKeybinding: (connectionId: string, id: string, patch: Partial<Omit<KeyNode, 'id'>>) => void;
    removeKeybinding: (connectionId: string, id: string) => void;
    removeKeybindings: (connectionId: string, ids: ReadonlyArray<string>) => void;
    addButton: (connectionId: string, data: Omit<ButtonNode, 'id'>) => string;
    updateButton: (connectionId: string, id: string, patch: Partial<Omit<ButtonNode, 'id'>>) => void;
    removeButton: (connectionId: string, id: string) => void;
    moveScript: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveAlias: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveTrigger: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveTimer: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveKeybinding: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveButton: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    groupTriggers: (connectionId: string, targetId: string, draggedId: string) => void;
    saveScriptEditorBounds: (connectionId: string, bounds: ScriptEditorBounds) => void;
    saveModalBounds: (connectionId: string, key: string, bounds: ModalBounds) => void;
    installPackage: (connectionId: string, manifest: PackageManifest, data: MudletImportResult) => void;
    uninstallPackage: (connectionId: string, packageName: string) => void;
    updatePackageManifest: (connectionId: string, packageName: string, patch: Partial<Omit<PackageManifest, 'name'>>) => void;
}

export const useAppStore = create<AppStore>()(
    persist(
        set => ({
            ...APP_DEFAULTS,
            addConnection: data => set(s => ({
                connections: [...s.connections, { ...data, id: crypto.randomUUID() }],
            })),
            updateConnection: (id, data) => set(s => ({
                connections: s.connections.map(c => c.id === id ? { ...data, id } : c),
            })),
            removeConnection: id => set(s => {
                const { [id]: _h, ...restHints } = s.connectionWindowHints;
                const { [id]: _e, ...restExtents } = s.connectionDockExtents;
                const { [id]: _sc, ...restScripts } = s.connectionScripts;
                const { [id]: _al, ...restAliases } = s.connectionAliases;
                const { [id]: _tr, ...restTriggers } = s.connectionTriggers;
                const { [id]: _ti, ...restTimers } = s.connectionTimers;
                const { [id]: _kb, ...restKeybindings } = s.connectionKeybindings;
                const { [id]: _bt, ...restButtons } = s.connectionButtons;
                const { [id]: _sb, ...restBounds } = s.connectionScriptEditorBounds;
                const { [id]: _mb, ...restModalBounds } = s.connectionModalBounds;
                const { [id]: _ui, ...restProfile } = s.connectionProfile;
                return {
                    connections: s.connections.filter(c => c.id !== id),
                    connectionProfile: restProfile,
                    connectionWindowHints: restHints,
                    connectionDockExtents: restExtents,
                    connectionScripts: restScripts,
                    connectionAliases: restAliases,
                    connectionTriggers: restTriggers,
                    connectionTimers: restTimers,
                    connectionKeybindings: restKeybindings,
                    connectionButtons: restButtons,
                    connectionScriptEditorBounds: restBounds,
                    connectionModalBounds: restModalBounds,
                    connectionPackages: ((): Record<string, PackageManifest[]> => {
                        const { [id]: _pk, ...rest } = s.connectionPackages;
                        return rest;
                    })(),
                };
            }),
            patchClient: patch => set(s => ({ client: { ...s.client, ...patch } })),
            patchConnectionProfile: (connectionId, patch) => set(s => {
                // Treat `undefined` as "remove the override" so callers can
                // restore fall-through to PROFILE_DEFAULTS (e.g. Mudlet's
                // resetBorderColor clearing outputBorderColor).
                const prev = s.connectionProfile[connectionId] ?? {};
                const next: Partial<ProfileSettings> = { ...prev, ...patch };
                for (const k of Object.keys(patch) as (keyof ProfileSettings)[]) {
                    if (patch[k] === undefined) delete next[k];
                }
                return { connectionProfile: { ...s.connectionProfile, [connectionId]: next } };
            }),
            saveWindowHint: (connectionId, panelId, hint) => set(s => ({
                connectionWindowHints: {
                    ...s.connectionWindowHints,
                    [connectionId]: { ...(s.connectionWindowHints[connectionId] ?? {}), [panelId]: hint },
                },
            })),
            clearWindowHints: (connectionId) => set(s => {
                const { [connectionId]: _, ...rest } = s.connectionWindowHints;
                return { connectionWindowHints: rest };
            }),
            saveDockExtents: (connectionId, extents) => set(s => ({
                connectionDockExtents: {
                    ...s.connectionDockExtents,
                    [connectionId]: extents,
                },
            })),
            addScript: (connectionId, data) => {
                const id = crypto.randomUUID();
                set(s => ({
                    connectionScripts: {
                        ...s.connectionScripts,
                        [connectionId]: [...(s.connectionScripts[connectionId] ?? []), { ...data, id }],
                    },
                }));
                return id;
            },
            updateScript: (connectionId, id, patch) => set(s => ({
                connectionScripts: {
                    ...s.connectionScripts,
                    [connectionId]: (s.connectionScripts[connectionId] ?? []).map(
                        sc => sc.id === id ? { ...sc, ...patch } : sc,
                    ),
                },
            })),
            removeScript: (connectionId, id) => set(s => {
                const current = s.connectionScripts[connectionId] ?? [];
                const toRemove = new Set([id, ...getDescendantIds(id, current)]);
                return {
                    connectionScripts: {
                        ...s.connectionScripts,
                        [connectionId]: current.filter(sc => !toRemove.has(sc.id)),
                    },
                };
            }),
            addAlias: (connectionId, data) => {
                const id = crypto.randomUUID();
                set(s => ({
                    connectionAliases: {
                        ...s.connectionAliases,
                        [connectionId]: [...(s.connectionAliases[connectionId] ?? []), { ...data, id }],
                    },
                }));
                return id;
            },
            updateAlias: (connectionId, id, patch) => set(s => ({
                connectionAliases: {
                    ...s.connectionAliases,
                    [connectionId]: (s.connectionAliases[connectionId] ?? []).map(
                        a => a.id === id ? { ...a, ...patch } : a,
                    ),
                },
            })),
            removeAlias: (connectionId, id) => set(s => {
                const current = s.connectionAliases[connectionId] ?? [];
                const toRemove = new Set([id, ...getDescendantIds(id, current)]);
                return {
                    connectionAliases: {
                        ...s.connectionAliases,
                        [connectionId]: current.filter(a => !toRemove.has(a.id)),
                    },
                };
            }),
            removeAliases: (connectionId, ids) => set(s => {
                if (ids.length === 0) return {};
                const current = s.connectionAliases[connectionId] ?? [];
                const toRemove = new Set<string>();
                for (const id of ids) {
                    toRemove.add(id);
                    for (const d of getDescendantIds(id, current)) toRemove.add(d);
                }
                return {
                    connectionAliases: {
                        ...s.connectionAliases,
                        [connectionId]: current.filter(a => !toRemove.has(a.id)),
                    },
                };
            }),
            addTrigger: (connectionId, data) => {
                const id = crypto.randomUUID();
                set(s => ({
                    connectionTriggers: {
                        ...s.connectionTriggers,
                        [connectionId]: [...(s.connectionTriggers[connectionId] ?? []), { ...data, id }],
                    },
                }));
                return id;
            },
            updateTrigger: (connectionId, id, patch) => set(s => ({
                connectionTriggers: {
                    ...s.connectionTriggers,
                    [connectionId]: (s.connectionTriggers[connectionId] ?? []).map(
                        t => t.id === id ? { ...t, ...patch } : t,
                    ),
                },
            })),
            updateTriggers: (connectionId, patches) => set(s => {
                if (patches.length === 0) return {};
                const byId = new Map(patches.map(p => [p.id, p.patch] as const));
                return {
                    connectionTriggers: {
                        ...s.connectionTriggers,
                        [connectionId]: (s.connectionTriggers[connectionId] ?? []).map(
                            t => byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t,
                        ),
                    },
                };
            }),
            removeTrigger: (connectionId, id) => set(s => {
                const current = s.connectionTriggers[connectionId] ?? [];
                const toRemove = new Set([id, ...getDescendantIds(id, current)]);
                return {
                    connectionTriggers: {
                        ...s.connectionTriggers,
                        [connectionId]: current.filter(t => !toRemove.has(t.id)),
                    },
                };
            }),
            removeTriggers: (connectionId, ids) => set(s => {
                if (ids.length === 0) return {};
                const current = s.connectionTriggers[connectionId] ?? [];
                const toRemove = new Set<string>();
                for (const id of ids) {
                    toRemove.add(id);
                    for (const d of getDescendantIds(id, current)) toRemove.add(d);
                }
                return {
                    connectionTriggers: {
                        ...s.connectionTriggers,
                        [connectionId]: current.filter(t => !toRemove.has(t.id)),
                    },
                };
            }),
            addTimer: (connectionId, data) => {
                const id = crypto.randomUUID();
                set(s => ({
                    connectionTimers: {
                        ...s.connectionTimers,
                        [connectionId]: [...(s.connectionTimers[connectionId] ?? []), { ...data, id }],
                    },
                }));
                return id;
            },
            updateTimer: (connectionId, id, patch) => set(s => ({
                connectionTimers: {
                    ...s.connectionTimers,
                    [connectionId]: (s.connectionTimers[connectionId] ?? []).map(
                        t => t.id === id ? { ...t, ...patch } : t,
                    ),
                },
            })),
            updateTimers: (connectionId, patches) => set(s => {
                if (patches.length === 0) return {};
                const byId = new Map(patches.map(p => [p.id, p.patch] as const));
                return {
                    connectionTimers: {
                        ...s.connectionTimers,
                        [connectionId]: (s.connectionTimers[connectionId] ?? []).map(
                            t => byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t,
                        ),
                    },
                };
            }),
            removeTimer: (connectionId, id) => set(s => {
                const current = s.connectionTimers[connectionId] ?? [];
                const toRemove = new Set([id, ...getDescendantIds(id, current)]);
                return {
                    connectionTimers: {
                        ...s.connectionTimers,
                        [connectionId]: current.filter(t => !toRemove.has(t.id)),
                    },
                };
            }),
            removeTimers: (connectionId, ids) => set(s => {
                if (ids.length === 0) return {};
                const current = s.connectionTimers[connectionId] ?? [];
                const toRemove = new Set<string>();
                for (const id of ids) {
                    toRemove.add(id);
                    for (const d of getDescendantIds(id, current)) toRemove.add(d);
                }
                return {
                    connectionTimers: {
                        ...s.connectionTimers,
                        [connectionId]: current.filter(t => !toRemove.has(t.id)),
                    },
                };
            }),
            addKeybinding: (connectionId, data) => {
                const id = crypto.randomUUID();
                set(s => ({
                    connectionKeybindings: {
                        ...s.connectionKeybindings,
                        [connectionId]: [...(s.connectionKeybindings[connectionId] ?? []), { ...data, id }],
                    },
                }));
                return id;
            },
            updateKeybinding: (connectionId, id, patch) => set(s => ({
                connectionKeybindings: {
                    ...s.connectionKeybindings,
                    [connectionId]: (s.connectionKeybindings[connectionId] ?? []).map(
                        k => k.id === id ? { ...k, ...patch } : k,
                    ),
                },
            })),
            removeKeybinding: (connectionId, id) => set(s => {
                const current = s.connectionKeybindings[connectionId] ?? [];
                const toRemove = new Set([id, ...getDescendantIds(id, current)]);
                return {
                    connectionKeybindings: {
                        ...s.connectionKeybindings,
                        [connectionId]: current.filter(k => !toRemove.has(k.id)),
                    },
                };
            }),
            removeKeybindings: (connectionId, ids) => set(s => {
                if (ids.length === 0) return {};
                const current = s.connectionKeybindings[connectionId] ?? [];
                const toRemove = new Set<string>();
                for (const id of ids) {
                    toRemove.add(id);
                    for (const d of getDescendantIds(id, current)) toRemove.add(d);
                }
                return {
                    connectionKeybindings: {
                        ...s.connectionKeybindings,
                        [connectionId]: current.filter(k => !toRemove.has(k.id)),
                    },
                };
            }),
            addButton: (connectionId, data) => {
                const id = crypto.randomUUID();
                set(s => ({
                    connectionButtons: {
                        ...s.connectionButtons,
                        [connectionId]: [...(s.connectionButtons[connectionId] ?? []), { ...data, id }],
                    },
                }));
                return id;
            },
            updateButton: (connectionId, id, patch) => set(s => ({
                connectionButtons: {
                    ...s.connectionButtons,
                    [connectionId]: (s.connectionButtons[connectionId] ?? []).map(
                        b => b.id === id ? { ...b, ...patch } : b,
                    ),
                },
            })),
            removeButton: (connectionId, id) => set(s => {
                const current = s.connectionButtons[connectionId] ?? [];
                const toRemove = new Set([id, ...getDescendantIds(id, current)]);
                return {
                    connectionButtons: {
                        ...s.connectionButtons,
                        [connectionId]: current.filter(b => !toRemove.has(b.id)),
                    },
                };
            }),
            moveScript: (connectionId, id, newParentId, insertBeforeId) => set(s => ({
                connectionScripts: {
                    ...s.connectionScripts,
                    [connectionId]: moveInList(s.connectionScripts[connectionId] ?? [], id, newParentId, insertBeforeId),
                },
            })),
            moveAlias: (connectionId, id, newParentId, insertBeforeId) => set(s => ({
                connectionAliases: {
                    ...s.connectionAliases,
                    [connectionId]: moveInList(s.connectionAliases[connectionId] ?? [], id, newParentId, insertBeforeId),
                },
            })),
            moveTrigger: (connectionId, id, newParentId, insertBeforeId) => set(s => ({
                connectionTriggers: {
                    ...s.connectionTriggers,
                    [connectionId]: moveInList(s.connectionTriggers[connectionId] ?? [], id, newParentId, insertBeforeId),
                },
            })),
            moveTimer: (connectionId, id, newParentId, insertBeforeId) => set(s => ({
                connectionTimers: {
                    ...s.connectionTimers,
                    [connectionId]: moveInList(s.connectionTimers[connectionId] ?? [], id, newParentId, insertBeforeId),
                },
            })),
            moveKeybinding: (connectionId, id, newParentId, insertBeforeId) => set(s => ({
                connectionKeybindings: {
                    ...s.connectionKeybindings,
                    [connectionId]: moveInList(s.connectionKeybindings[connectionId] ?? [], id, newParentId, insertBeforeId),
                },
            })),
            moveButton: (connectionId, id, newParentId, insertBeforeId) => set(s => ({
                connectionButtons: {
                    ...s.connectionButtons,
                    [connectionId]: moveInList(s.connectionButtons[connectionId] ?? [], id, newParentId, insertBeforeId),
                },
            })),
            groupTriggers: (connectionId, targetId, draggedId) => set(s => {
                const current = s.connectionTriggers[connectionId] ?? [];
                // Target becomes the group; dragged becomes a child of target.
                return {
                    connectionTriggers: {
                        ...s.connectionTriggers,
                        [connectionId]: current.map(t => {
                            if (t.id === targetId) return { ...t, isGroup: true };
                            if (t.id === draggedId) return { ...t, parentId: targetId };
                            return t;
                        }),
                    },
                };
            }),
            saveScriptEditorBounds: (connectionId, bounds) => set(s => ({
                connectionScriptEditorBounds: {
                    ...s.connectionScriptEditorBounds,
                    [connectionId]: bounds,
                },
            })),
            saveModalBounds: (connectionId, key, bounds) => set(s => ({
                connectionModalBounds: {
                    ...s.connectionModalBounds,
                    [connectionId]: { ...(s.connectionModalBounds[connectionId] ?? {}), [key]: bounds },
                },
            })),
            installPackage: (connectionId, manifest, data) => set(s => {
                // Replace any prior install of the same package name (re-install).
                const prior = (s.connectionPackages[connectionId] ?? []).filter(p => p.name !== manifest.name);
                const stripPkg = <T extends { packageName?: string }>(arr: T[]): T[] =>
                    arr.filter(n => n.packageName !== manifest.name);
                return {
                    connectionScripts:     { ...s.connectionScripts,     [connectionId]: [...stripPkg(s.connectionScripts[connectionId]     ?? []), ...data.scripts]  },
                    connectionAliases:     { ...s.connectionAliases,     [connectionId]: [...stripPkg(s.connectionAliases[connectionId]     ?? []), ...data.aliases]  },
                    connectionTriggers:    { ...s.connectionTriggers,    [connectionId]: [...stripPkg(s.connectionTriggers[connectionId]    ?? []), ...data.triggers] },
                    connectionTimers:      { ...s.connectionTimers,      [connectionId]: [...stripPkg(s.connectionTimers[connectionId]      ?? []), ...data.timers]   },
                    connectionKeybindings: { ...s.connectionKeybindings, [connectionId]: [...stripPkg(s.connectionKeybindings[connectionId] ?? []), ...data.keys]     },
                    connectionButtons:     { ...s.connectionButtons,     [connectionId]: [...stripPkg(s.connectionButtons[connectionId]     ?? []), ...data.buttons]  },
                    connectionPackages:    { ...s.connectionPackages,    [connectionId]: [...prior, manifest] },
                };
            }),
            updatePackageManifest: (connectionId, packageName, patch) => set(s => ({
                connectionPackages: {
                    ...s.connectionPackages,
                    [connectionId]: (s.connectionPackages[connectionId] ?? []).map(p =>
                        p.name === packageName ? { ...p, ...patch, name: p.name } : p,
                    ),
                },
            })),
            uninstallPackage: (connectionId, packageName) => set(s => {
                const stripPkg = <T extends { packageName?: string }>(arr: T[]): T[] =>
                    arr.filter(n => n.packageName !== packageName);
                return {
                    connectionScripts:     { ...s.connectionScripts,     [connectionId]: stripPkg(s.connectionScripts[connectionId]     ?? []) },
                    connectionAliases:     { ...s.connectionAliases,     [connectionId]: stripPkg(s.connectionAliases[connectionId]     ?? []) },
                    connectionTriggers:    { ...s.connectionTriggers,    [connectionId]: stripPkg(s.connectionTriggers[connectionId]    ?? []) },
                    connectionTimers:      { ...s.connectionTimers,      [connectionId]: stripPkg(s.connectionTimers[connectionId]      ?? []) },
                    connectionKeybindings: { ...s.connectionKeybindings, [connectionId]: stripPkg(s.connectionKeybindings[connectionId] ?? []) },
                    connectionButtons:     { ...s.connectionButtons,     [connectionId]: stripPkg(s.connectionButtons[connectionId]     ?? []) },
                    connectionPackages:    { ...s.connectionPackages,    [connectionId]: (s.connectionPackages[connectionId] ?? []).filter(p => p.name !== packageName) },
                };
            }),
        }),
        {
            name: 'mudix_v1',
            version: 18,
            // Coalesce rapid mutations (e.g. an enableTrigger that touches N
            // matching nodes, or a script edit firing on every keystroke) into
            // one JSON.stringify + localStorage write. createJSONStorage runs
            // the stringify before our adapter sees the value, so we implement
            // PersistStorage directly to defer serialization until flush time.
            storage: createDebouncedJsonStorage<AppSchema>(5000),
            partialize: ({ connections, client, connectionProfile, connectionWindowHints, connectionDockExtents, connectionScripts, connectionAliases, connectionTriggers, connectionTimers, connectionKeybindings, connectionButtons, connectionScriptEditorBounds, connectionModalBounds, connectionPackages }) => ({
                connections, client, connectionProfile, connectionWindowHints, connectionDockExtents, connectionScripts, connectionAliases, connectionTriggers, connectionTimers, connectionKeybindings, connectionButtons, connectionScriptEditorBounds, connectionModalBounds, connectionPackages,
            }),
            migrate: (saved, version) => {
                const s = saved as Partial<AppSchema> & { connections?: any[]; ui?: any };
                type V1Connection = { id: string; name: string; host: string; port: number; ssl: boolean };
                const connections: MudConnection[] = (s.connections ?? []).map(c => {
                    if (version < 2 && !('url' in c)) {
                        const v1 = c as V1Connection;
                        return { id: v1.id, name: v1.name, url: `${v1.ssl ? 'wss' : 'ws'}://${v1.host}:${v1.port}` };
                    }
                    return c as MudConnection;
                });

                // v11: trigger patterns migrated from string[] to TriggerPattern[].
                // v12: added fireLength (chain length), multipleMatches, highlight, command fields to TriggerNode.
                // v13: added multiline, delta, isFilter fields to TriggerNode.
                // For version < 10 all tree data was intentionally reset (tree structure change in v10).
                const rawTriggers: Record<string, any[]> = version >= 10 ? ((s as any).connectionTriggers ?? {}) : {};
                const connectionTriggers = Object.fromEntries(
                    Object.entries(rawTriggers).map(([connId, triggers]) => [
                        connId,
                        triggers.map((t: any) => ({
                            ...t,
                            patterns: Array.isArray(t.patterns)
                                ? t.patterns.map((p: any) =>
                                    typeof p === 'string' ? { text: p, type: 'regex' } : p
                                )
                                : [],
                            fireLength: t.fireLength ?? 0,
                            multipleMatches: t.multipleMatches ?? false,
                            multiline: t.multiline ?? false,
                            delta: t.delta ?? 0,
                            isFilter: t.isFilter ?? false,
                        })),
                    ])
                );

                // v18: split legacy `ui` (one shared UISettings) into client (theme only)
                // and per-connection profile overrides. Theme moves up to client; every
                // other field is copied verbatim into every existing connection's
                // override so users don't lose their current font/border/etc. settings.
                const legacyUi = s.ui ?? {};
                const client = { theme: (legacyUi.theme ?? APP_DEFAULTS.client.theme) };
                const persisted = (s as any).connectionProfile as Record<string, Partial<ProfileSettings>> | undefined;
                let connectionProfile: Record<string, Partial<ProfileSettings>>;
                if (persisted) {
                    connectionProfile = persisted;
                } else {
                    const seed: Partial<ProfileSettings> = {};
                    for (const k of ['showTimestamps','fontSize','outputBackground','outputFont','outputWrapAt','outputBackgroundColor','outputBorders','outputBorderColor','promptTimeoutMs'] as const) {
                        if (legacyUi[k] !== undefined) (seed as any)[k] = legacyUi[k];
                    }
                    connectionProfile = Object.fromEntries(connections.map(c => [c.id, { ...seed }]));
                }

                return {
                    ...APP_DEFAULTS,
                    connections,
                    client,
                    connectionProfile,
                    connectionWindowHints: s.connectionWindowHints ?? {},
                    connectionDockExtents: s.connectionDockExtents ?? {},
                    // For version >= 10 preserve all tree data (tree structure was already correct).
                    // For version < 10 tree data is reset (structure changed in v10).
                    ...(version >= 10 ? {
                        connectionScripts: s.connectionScripts ?? {},
                        connectionAliases: s.connectionAliases ?? {},
                        connectionTimers: s.connectionTimers ?? {},
                        connectionKeybindings: s.connectionKeybindings ?? {},
                        connectionScriptEditorBounds: s.connectionScriptEditorBounds ?? {},
                        connectionModalBounds: s.connectionModalBounds ?? {},
                    } : {}),
                    // v17: introduced connectionButtons (Mudlet-style toolbars/buttons).
                    connectionButtons: (s as Partial<AppSchema>).connectionButtons ?? {},
                    // v15: introduced connectionPackages (manifest of installed Mudlet packages).
                    connectionPackages: (s as Partial<AppSchema>).connectionPackages ?? {},
                    connectionTriggers,
                };
            },
        },
    ),
);
