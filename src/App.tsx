import { useEffect, useRef, useState } from 'react';
import { ConnectionScreen } from './ui/ConnectionScreen';
import { SettingsModal } from './ui/SettingsModal';
import { ProfileBusyScreen } from './ui/ProfileBusyScreen';
import { ProfileSession } from './ProfileSession';
import { acquireProfileLock, isProfileLockHeld } from './utils/profileLock';
import { useAppStore, type MudConnection } from './storage';

export default function App() {
    const [activeConnection, setActiveConnection] = useState<MudConnection | null>(null);
    const [autoConnect, setAutoConnect] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Single-owner lock state for the open profile. The session is mounted only
    // once we own the lock ('held'); 'acquiring' is the brief wait for a free
    // lock, 'waiting' means another tab currently owns the profile.
    const [lockPhase, setLockPhase] = useState<'none' | 'acquiring' | 'waiting' | 'held'>('none');

    const deepLinkProfileId = useRef(new URLSearchParams(window.location.search).get('profile'));
    const theme = useAppStore(s => s.client.theme);
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);

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
        openProfile(conn, conn.autoReconnect ?? false);
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
        if (!activeConnection) { setLockPhase('none'); return; }
        const id = activeConnection.id;
        const ctrl = new AbortController();
        let cancelled = false;
        setLockPhase('acquiring');
        // Pick the right initial message: if another tab already holds it, show
        // the "waiting" screen rather than a flash of "opening".
        void isProfileLockHeld(id).then(held => {
            if (!cancelled && held) setLockPhase(p => (p === 'held' ? p : 'waiting'));
        });
        const handle = acquireProfileLock(id, ctrl.signal);
        handle.acquired.then(() => { if (!cancelled) setLockPhase('held'); }).catch(() => { /* aborted */ });
        return () => {
            cancelled = true;
            ctrl.abort();
            handle.release();
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
