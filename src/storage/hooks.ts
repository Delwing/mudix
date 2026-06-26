import { createContext, useContext } from 'react';
import { useAppStore } from './appStore';
import { selectProfileField, type ClientSettings, type ProfileSettings, type Theme } from './schema';

/**
 * Active profile id, provided by ProfileSession. `null` outside a profile
 * (e.g. on the connection screen) — settings consumers fall through to
 * PROFILE_DEFAULTS in that case.
 */
export const ConnectionIdContext = createContext<string | null>(null);

export function useConnectionId(): string | null {
    return useContext(ConnectionIdContext);
}

/** Read one ProfileSettings field for the active profile (from context). */
export function useProfileField<K extends keyof ProfileSettings>(key: K): ProfileSettings[K] {
    const id = useConnectionId();
    return useAppStore(s => selectProfileField(s, id, key));
}

/** Read one ClientSettings field. */
export function useClientField<K extends keyof ClientSettings>(key: K): ClientSettings[K] {
    return useAppStore(s => s.client[key]);
}

/** The theme actually in effect: the active profile's override if it has one,
 *  else the launcher theme. Use anywhere a profile-scoped component needs the
 *  current theme (e.g. CodeMirror editors). Outside a profile (no context) it
 *  resolves to the launcher theme. */
export function useEffectiveTheme(): Theme {
    const id = useConnectionId();
    return useAppStore(s => (id ? s.connectionProfile[id]?.theme : undefined) ?? s.client.theme);
}
