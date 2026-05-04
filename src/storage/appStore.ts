import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { APP_DEFAULTS, type AppSchema, type MudConnection, type AliasNode, type KeyNode, type TimerNode, type TriggerNode, type ScriptNode, type ScriptEditorBounds, type UISettings } from './schema';
import type { WindowOpenOptions } from '../ui/windows/types';

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
    patchUI: (patch: Partial<UISettings>) => void;
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
    removeTrigger: (connectionId: string, id: string) => void;
    addTimer: (connectionId: string, data: Omit<TimerNode, 'id'>) => string;
    updateTimer: (connectionId: string, id: string, patch: Partial<Omit<TimerNode, 'id'>>) => void;
    removeTimer: (connectionId: string, id: string) => void;
    addKeybinding: (connectionId: string, data: Omit<KeyNode, 'id'>) => string;
    updateKeybinding: (connectionId: string, id: string, patch: Partial<Omit<KeyNode, 'id'>>) => void;
    removeKeybinding: (connectionId: string, id: string) => void;
    moveScript: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveAlias: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveTrigger: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveTimer: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    moveKeybinding: (connectionId: string, id: string, newParentId: string | null, insertBeforeId: string | null) => void;
    saveScriptEditorBounds: (connectionId: string, bounds: ScriptEditorBounds) => void;
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
                return {
                    connections: s.connections.filter(c => c.id !== id),
                    connectionWindowHints: restHints,
                    connectionDockExtents: restExtents,
                };
            }),
            patchUI: patch => set(s => ({ ui: { ...s.ui, ...patch } })),
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
            saveScriptEditorBounds: (connectionId, bounds) => set(s => ({
                connectionScriptEditorBounds: {
                    ...s.connectionScriptEditorBounds,
                    [connectionId]: bounds,
                },
            })),
        }),
        {
            name: 'mudix_v1',
            version: 11,
            partialize: ({ connections, ui, connectionWindowHints, connectionDockExtents, connectionScripts, connectionAliases, connectionTriggers, connectionTimers, connectionKeybindings, connectionScriptEditorBounds }) => ({
                connections, ui, connectionWindowHints, connectionDockExtents, connectionScripts, connectionAliases, connectionTriggers, connectionTimers, connectionKeybindings, connectionScriptEditorBounds,
            }),
            migrate: (saved, version) => {
                const s = saved as Partial<AppSchema> & { connections?: any[] };
                type V1Connection = { id: string; name: string; host: string; port: number; ssl: boolean };
                const connections: MudConnection[] = (s.connections ?? []).map(c => {
                    if (version < 2 && !('url' in c)) {
                        const v1 = c as V1Connection;
                        return { id: v1.id, name: v1.name, url: `${v1.ssl ? 'wss' : 'ws'}://${v1.host}:${v1.port}` };
                    }
                    return c as MudConnection;
                });

                // v11: trigger patterns migrated from string[] to TriggerPattern[].
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
                        })),
                    ])
                );

                return {
                    ...APP_DEFAULTS,
                    connections,
                    ui: { ...APP_DEFAULTS.ui, ...(s.ui ?? {}) },
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
                    } : {}),
                    connectionTriggers,
                };
            },
        },
    ),
);
