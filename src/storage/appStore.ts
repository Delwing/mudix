import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { APP_DEFAULTS, type AppSchema, type MudConnection, type PermanentAlias, type PermanentTrigger, type Script, type UISettings } from './schema';
import type { SerializedLayout } from '../ui/windows/types';

interface AppStore extends AppSchema {
    addConnection: (data: Omit<MudConnection, 'id'>) => void;
    removeConnection: (id: string) => void;
    patchUI: (patch: Partial<UISettings>) => void;
    saveLayout: (connectionId: string, layout: SerializedLayout) => void;
    clearLayout: (connectionId: string) => void;
    addScript: (connectionId: string, data: Omit<Script, 'id'>) => string;
    updateScript: (connectionId: string, id: string, patch: Partial<Omit<Script, 'id'>>) => void;
    removeScript: (connectionId: string, id: string) => void;
    addAlias: (connectionId: string, data: Omit<PermanentAlias, 'id'>) => string;
    updateAlias: (connectionId: string, id: string, patch: Partial<Omit<PermanentAlias, 'id'>>) => void;
    removeAlias: (connectionId: string, id: string) => void;
    addTrigger: (connectionId: string, data: Omit<PermanentTrigger, 'id'>) => string;
    updateTrigger: (connectionId: string, id: string, patch: Partial<Omit<PermanentTrigger, 'id'>>) => void;
    removeTrigger: (connectionId: string, id: string) => void;
}

export const useAppStore = create<AppStore>()(
    persist(
        set => ({
            ...APP_DEFAULTS,
            addConnection: data => set(s => ({
                connections: [...s.connections, { ...data, id: crypto.randomUUID() }],
            })),
            removeConnection: id => set(s => {
                const { [id]: _, ...rest } = s.connectionLayouts;
                return {
                    connections: s.connections.filter(c => c.id !== id),
                    connectionLayouts: rest,
                };
            }),
            patchUI: patch => set(s => ({ ui: { ...s.ui, ...patch } })),
            saveLayout: (connectionId, layout) => set(s => ({
                connectionLayouts: { ...s.connectionLayouts, [connectionId]: layout },
            })),
            clearLayout: (connectionId) => set(s => {
                const { [connectionId]: _, ...rest } = s.connectionLayouts;
                return { connectionLayouts: rest };
            }),
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
            removeScript: (connectionId, id) => set(s => ({
                connectionScripts: {
                    ...s.connectionScripts,
                    [connectionId]: (s.connectionScripts[connectionId] ?? []).filter(sc => sc.id !== id),
                },
            })),
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
            removeAlias: (connectionId, id) => set(s => ({
                connectionAliases: {
                    ...s.connectionAliases,
                    [connectionId]: (s.connectionAliases[connectionId] ?? []).filter(a => a.id !== id),
                },
            })),
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
            removeTrigger: (connectionId, id) => set(s => ({
                connectionTriggers: {
                    ...s.connectionTriggers,
                    [connectionId]: (s.connectionTriggers[connectionId] ?? []).filter(t => t.id !== id),
                },
            })),
        }),
        {
            name: 'mudix_v1',
            version: 6,
            partialize: ({ connections, ui, connectionLayouts, connectionScripts, connectionAliases, connectionTriggers }) => ({
                connections, ui, connectionLayouts, connectionScripts, connectionAliases, connectionTriggers,
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
                return {
                    ...APP_DEFAULTS,
                    ...s,
                    ui: { ...APP_DEFAULTS.ui, ...(s.ui ?? {}) },
                    connections,
                    connectionLayouts: s.connectionLayouts ?? {},
                    connectionScripts: s.connectionScripts ?? {},
                    connectionAliases: s.connectionAliases ?? {},
                    connectionTriggers: s.connectionTriggers ?? {},
                };
            },
        },
    ),
);
