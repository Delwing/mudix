import type { SessionStatus } from '../mud/MudSession';

interface ToolbarProps {
    url: string;
    onUrlChange: (url: string) => void;
    status: SessionStatus;
    ping: number | null;
    onConnect: () => void;
    onDisconnect: () => void;
}

export function Toolbar({ url, onUrlChange, status, ping, onConnect, onDisconnect }: ToolbarProps) {
    const connected = status === 'connected';
    const connecting = status === 'connecting';

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && status === 'disconnected') {
            onConnect();
        }
    };

    return (
        <div className="toolbar">
            <span className="brand">mudix</span>

            <input
                className="url-input"
                value={url}
                onChange={e => onUrlChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="wss://host:port/path"
                disabled={connected || connecting}
                spellCheck={false}
                aria-label="Server URL"
            />

            {!connected ? (
                <button
                    className="btn btn-connect"
                    onClick={onConnect}
                    disabled={connecting || !url.trim()}
                >
                    {connecting ? 'Connecting…' : 'Connect'}
                </button>
            ) : (
                <button className="btn btn-disconnect" onClick={onDisconnect}>
                    Disconnect
                </button>
            )}

            <span
                className={`status-dot status-${status}`}
                title={status}
                aria-label={status}
            />
            {ping !== null && (
                <span className="ping">{Math.round(ping)} ms</span>
            )}
        </div>
    );
}
