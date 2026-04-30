import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { APP_DEFAULTS, type AppSchema, type MudConnection, type UISettings } from './schema';

interface AppStore extends AppSchema {
    addConnection: (data: Omit<MudConnection, 'id'>) => void;
    removeConnection: (id: string) => void;
    patchUI: (patch: Partial<UISettings>) => void;
}

export const useAppStore = create<AppStore>()(
    persist(
        set => ({
            ...APP_DEFAULTS,
            addConnection: data => set(s => ({
                connections: [...s.connections, { ...data, id: crypto.randomUUID() }],
            })),
            removeConnection: id => set(s => ({
                connections: s.connections.filter(c => c.id !== id),
            })),
            patchUI: patch => set(s => ({ ui: { ...s.ui, ...patch } })),
        }),
        {
            name: 'mudix_v1',
            version: 2,
            partialize: ({ connections, ui }) => ({ connections, ui }),
            migrate: (saved, version) => {
                const s = saved as Partial<AppSchema> & { connections?: any[] };
                type V1Connection = { id: string; name: string; host: string; port: number; ssl: boolean };
                const connections: MudConnection[] = (s.connections ?? []).map(c => {
                    // v1 → v2: flatten host/port/ssl into a url string
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
                };
            },
        },
    ),
);
