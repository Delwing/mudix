import { useEffect, useRef } from 'react';
import type { MudSession } from '../mud/MudSession';
import { DEFAULT_PROXY_URL, type MudConnection } from '../storage';
import { useAppStore } from '../storage';
import { AliasEngine } from '../mud/aliases/AliasEngine';
import { TriggerEngine } from '../mud/triggers/TriggerEngine';
import { TimerEngine } from '../mud/timers/TimerEngine';
import { KeyEngine } from '../mud/keybindings/KeyEngine';
import { ScriptingEngine } from '../scripting/ScriptingEngine';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';

/**
 * Creates and tears down all scripting engines tied to a session lifetime.
 * Only ScriptingEngine is exposed — it owns the alias/trigger/timer/key
 * engines internally and subscribes to the appStore to keep them in sync.
 */
export function useEngines(session: MudSession, active: boolean, connection: MudConnection | null, vfs: ProfileVFS | null) {
    const engineRef = useRef<ScriptingEngine | null>(null);

    useEffect(() => {
        if (!active || !connection) return;
        const alias = new AliasEngine();
        const trigger = new TriggerEngine();
        const timer = new TimerEngine();
        const key = new KeyEngine();
        // Read fresh from the store on every HTTP call so live edits to the
        // proxy URL take effect without recreating the runtime.
        const proxyUrlGetter = () => {
            const state = useAppStore.getState();
            const c = state.connections.find(x => x.id === connection.id);
            // Precedence: connection-level proxy > user's deployed proxy > built-in default.
            return c?.proxyUrl?.trim() || state.client.userProxyUrl || DEFAULT_PROXY_URL;
        };
        const engine = new ScriptingEngine(session, alias, trigger, timer, key, connection.id, connection.name, proxyUrlGetter, vfs);
        engineRef.current = engine;
        return () => {
            engine.destroy();
            alias.destroy();
            trigger.destroy();
            timer.destroy();
            key.destroy();
            engineRef.current = null;
        };
    }, [session, active, connection, vfs]);

    return { engineRef };
}
