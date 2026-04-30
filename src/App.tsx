import { useEffect, useRef, useState } from 'react';
import { useMudSession } from './hooks/useMudSession';
import { Toolbar } from './ui/Toolbar';
import { CommandBar } from './ui/CommandBar';
import { OutputArea } from './ui/output/OutputArea';

export default function App() {
    const { session, status, ping, connect, disconnect, send } = useMudSession();
    const [url, setUrl] = useState('');
    const [command, setCommand] = useState('');
    const [hasConnected, setHasConnected] = useState(false);
    const commandInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (status === 'connecting' || status === 'connected') {
            setHasConnected(true);
        }
    }, [status]);

    const handleConnect = () => {
        const trimmedUrl = url.trim();
        if (trimmedUrl) connect(trimmedUrl);
    };

    const handleSend = () => {
        if (command.trim()) {
            send(command);
            setCommand('');
        }
    };

    return (
        <div className="app">
            <Toolbar
                url={url}
                onUrlChange={setUrl}
                status={status}
                ping={ping}
                onConnect={handleConnect}
                onDisconnect={disconnect}
            />

            <div className="output-section">
                {hasConnected ? (
                    <OutputArea session={session} stickyLines={5} />
                ) : (
                    <div className="empty-state">
                        Enter a server address and click Connect.
                    </div>
                )}
            </div>

            <CommandBar
                command={command}
                onCommandChange={setCommand}
                connected={status === 'connected'}
                commandInputRef={commandInputRef}
                onSubmit={handleSend}
            />
        </div>
    );
}
