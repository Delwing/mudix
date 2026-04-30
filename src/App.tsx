import { useRef, useState } from 'react';
import { useMudSession } from './hooks/useMudSession';
import { Toolbar } from './ui/Toolbar';
import { CommandBar } from './ui/CommandBar';
import { OutputArea } from './ui/output/OutputArea';
import { ConnectionScreen } from './ui/ConnectionScreen';
import { useAppStore, connectionUrl, type MudConnection } from './storage';

export default function App() {
    const { session, status, ping, passwordMode, connect, disconnect, send } = useMudSession();
    const [command, setCommand] = useState('');
    const [activeConnection, setActiveConnection] = useState<MudConnection | null>(null);
    const [sessionStarted, setSessionStarted] = useState(false);
    const commandInputRef = useRef<HTMLInputElement>(null);
    const connections = useAppStore(s => s.connections);
    const addConnection = useAppStore(s => s.addConnection);
    const removeConnection = useAppStore(s => s.removeConnection);

    const handleConnect = (connection: MudConnection) => {
        setActiveConnection(connection);
        setSessionStarted(true);
        connect(connectionUrl(connection));
    };

    const handleDisconnect = () => {
        disconnect();
    };

    const handleReconnect = () => {
        if (activeConnection) connect(connectionUrl(activeConnection));
    };

    const handleNewConnection = () => {
        disconnect();
        setActiveConnection(null);
        setSessionStarted(false);
    };

    const handleSend = () => {
        if (command.trim()) {
            send(command);
            setCommand('');
        }
    };

    if (!sessionStarted) {
        return (
            <div className="app">
                <ConnectionScreen
                    connections={connections}
                    connecting={status === 'connecting'}
                    connectingId={activeConnection?.id ?? null}
                    onConnect={handleConnect}
                    onAdd={addConnection}
                    onDelete={removeConnection}
                />
            </div>
        );
    }

    return (
        <div className="app">
            <Toolbar
                connectionName={activeConnection?.name ?? ''}
                status={status}
                ping={ping}
                onDisconnect={handleDisconnect}
                onReconnect={handleReconnect}
                onNewConnection={handleNewConnection}
            />
            <div className="output-section">
                <OutputArea session={session} stickyLines={5} />
            </div>
            <CommandBar
                command={command}
                onCommandChange={setCommand}
                connected={status === 'connected'}
                passwordMode={passwordMode}
                commandInputRef={commandInputRef}
                onSubmit={handleSend}
            />
        </div>
    );
}
