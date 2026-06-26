import { useEffect, useRef, useState } from 'react';
import { ConnectionScreen } from './ui/ConnectionScreen';
import { SettingsModal } from './ui/SettingsModal';
import { ProfileBusyScreen } from './ui/ProfileBusyScreen';
import { ProfileSession } from './ProfileSession';
import { acquireProfileLock, isProfileLockHeld } from './utils/profileLock';
import { ProfileVFS } from './scripting/vfs/ProfileVFS';
import { registerVfs, unregisterVfs } from './scripting/vfs/vfsBridge';
import { loadProfileData } from './storage/profileVfsData';
import { useAppStore, type MudConnection } from './storage';

export default function App() {
    const [activeConnection, setActiveConnection] = useState<MudConnection | null>(null);
    const [autoConnect, setAutoConnect] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Single-owner lock state for the open profile. The session is mounted only
    // once we own the lock ('held'); 'acquiring' is the brief wait for a free
    // lock, 'waiting' means another tab currently owns the profile.
    const [lockPhase, setLockPhase] = useState<'none' | 'acquiring' | 'waiting' | 'held'>('none');
    // The open profile's VFS, mounted here (after the lock, before the session
    // renders) so per-profile data is available synchronously at first paint.
    // App owns its lifecycle; the engine just consumes it.
    const [profileVfs, setProfileVfs] = useState<ProfileVFS | null>(null);

    const deepLinkProfileId = useRef(new URLSearchParams(window.location.search).get('profile'));
    // `&connect=1` (set by loadProfile in another tab) auto-dials on open instead
    // of just opening the profile. Read once, alongside the profile id.
    const deepLinkConnect = useRef(new URLSearchParams(window.location.search).get('connect') === '1');
    // Theme is per-profile with a global launcher fallback. While a profile is
    // open (lock held), its own theme override wins; on the connection screen /
    // busy screen we use the launcher theme. Applied in one place so there's a
    // single owner of document.documentElement.dataset.theme.
    const launcherTheme = useAppStore(s => s.client.theme);
    const profileTheme = useAppStore(s => (activeConnection ? s.connectionProfile[activeConnection.id]?.theme : undefined));
    const effectiveTheme = (activeConnection && lockPhase === 'held' && profileTheme) ? profileTheme : launcherTheme;
    useEffect(() => {
        document.documentElement.dataset.theme = effectiveTheme;
    }, [effectiveTheme]);

    const connections = useAppStore(s => s.connections);
    const addConnection    = useAppStore(s => s.addConnection);
    const updateConnection = useAppStore(s => s.updateConnection);
    const removeConnection = useAppStore(s => s.removeConnection);

    const setProfileQuery = (id: string | null) => {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set('profile', id);
        else url.searchParams.delete('profile');
        window.history.replaceState(null, '', url.toString());
    };

    const openProfile = (connection: MudConnection, withConnect: boolean) => {
        setAutoConnect(withConnect);
        setActiveConnection(connection);
        setProfileQuery(connection.id);
    };

    // Open (but don't dial) when the page is loaded with ?profile=<id>.
    // User can hit Connect from the toolbar to actually dial.
    useEffect(() => {
        const id = deepLinkProfileId.current;
        if (!id || activeConnection) return;
        const conn = connections.find(c => c.id === id);
        if (!conn) return;
        deepLinkProfileId.current = null;
        const forceConnect = deepLinkConnect.current;
        deepLinkConnect.current = false;
        openProfile(conn, forceConnect || (conn.autoReconnect ?? false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connections]);

    const handleCloseProfile = () => {
        setActiveConnection(null);
        setProfileQuery(null);
    };

    // Hold the profile's cross-tab lock for as long as it's open here. The
    // session below is only rendered once we own it, so its VFS/SQLite/map are
    // never mounted concurrently with another tab's. Releasing on cleanup (and
    // the browser's auto-release on tab close) hands ownership to any tab queued
    // behind us.
    useEffect(() => {
        if (!activeConnection) { setLockPhase('none'); setProfileVfs(null); return; }
        const id = activeConnection.id;
        const ctrl = new AbortController();
        let cancelled = false;
        let mountedVfs: ProfileVFS | null = null;
        setLockPhase('acquiring');
        setProfileVfs(null);
        // Pick the right initial message: if another tab already holds it, show
        // the "waiting" screen rather than a flash of "opening".
        void isProfileLockHeld(id).then(held => {
            if (!cancelled && held) setLockPhase(p => (p === 'held' ? p : 'waiting'));
        });
        const handle = acquireProfileLock(id, ctrl.signal);
        handle.acquired.then(async () => {
            if (cancelled) return;
            // Mount the profile's VFS up front, before the session renders, so
            // per-profile data is ready synchronously at first paint. The engine
            // consumes this instance; App owns register/flush/unmount.
            let vfs: ProfileVFS | null = null;
            try {
                vfs = await ProfileVFS.mount(id);
            } catch (e) {
                console.error('[App] profile VFS mount failed:', e);
            }
            if (cancelled) {
                // Acquired + mounted but we're already tearing down — clean up.
                if (vfs) { const v = vfs; void v.flush().finally(() => v.unmount()); }
                return;
            }
            if (vfs) {
                registerVfs(id, vfs);
                mountedVfs = vfs;
                // Seed the store from .mudix/profile.json (and run the one-time
                // v21 migration) before the session renders, so the profile's
                // settings/layout/protocols are present for the synchronous reads.
                loadProfileData(vfs, id);
            }
            setProfileVfs(vfs);
            setLockPhase('held');
        }).catch(() => { /* aborted */ });
        return () => {
            cancelled = true;
            ctrl.abort();
            handle.release();
            if (mountedVfs) {
                const v = mountedVfs;
                unregisterVfs(id);
                void v.flush().finally(() => v.unmount());
            }
        };
    }, [activeConnection]);

    const handleToggleSettings = () => setSettingsOpen(v => !v);

    if (activeConnection) {
        // Never mount the session until we own the lock — that's what keeps the
        // profile's on-disk state single-writer across tabs.
        if (lockPhase !== 'held') {
            return (
                <ProfileBusyScreen
                    name={activeConnection.name}
                    waiting={lockPhase === 'waiting'}
                    onBack={handleCloseProfile}
                />
            );
        }
        return (
            <ProfileSession
                key={activeConnection.id}
                connection={activeConnection}
                autoConnect={autoConnect}
                vfs={profileVfs}
                settingsOpen={settingsOpen}
                onToggleSettings={handleToggleSettings}
                onCloseProfile={handleCloseProfile}
            />
        );
    }

    return (
        <div className="app">
            <ConnectionScreen
                connections={connections}
                connecting={false}
                connectingId={null}
                onConnect={(conn) => openProfile(conn, true)}
                onOpen={(conn) => openProfile(conn, conn.autoReconnect ?? false)}
                onAdd={addConnection}
                onUpdate={updateConnection}
                onDelete={removeConnection}
                onOpenSettings={handleToggleSettings}
            />
            {settingsOpen && (
                <SettingsModal
                    onClose={handleToggleSettings}
                    connectionId={null}
                    vfs={null}
                />
            )}
        </div>
    );
}
