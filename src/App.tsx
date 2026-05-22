import { useEffect, useRef, useState } from 'react';
import { ConnectionScreen } from './ui/ConnectionScreen';
import { SettingsModal } from './ui/SettingsModal';
import { ProfileSession } from './ProfileSession';
import { useAppStore, type MudConnection } from './storage';

export default function App() {
    const [activeConnection, setActiveConnection] = useState<MudConnection | null>(null);
    const [autoConnect, setAutoConnect] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

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

    // Auto-connect when the page is loaded with ?profile=<id>
    useEffect(() => {
        const id = deepLinkProfileId.current;
        if (!id || activeConnection) return;
        const conn = connections.find(c => c.id === id);
        if (!conn) return;
        deepLinkProfileId.current = null;
        openProfile(conn, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connections]);

    const handleCloseProfile = () => {
        setActiveConnection(null);
        setProfileQuery(null);
    };

    const handleToggleSettings = () => setSettingsOpen(v => !v);

    if (activeConnection) {
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
                onOpen={(conn) => openProfile(conn, false)}
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
