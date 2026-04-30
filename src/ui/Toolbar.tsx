import { Button } from './components';
import type { SessionStatus } from '../mud/MudSession';

interface ToolbarProps {
    connectionName: string;
    status: SessionStatus;
    ping: number | null;
    onDisconnect: () => void;
    onReconnect: () => void;
    onNewConnection: () => void;
}

export function Toolbar({ connectionName, status, ping, onDisconnect, onReconnect, onNewConnection }: ToolbarProps) {
    return (
        <div className="toolbar">
            <span className="brand">mudix</span>
            <span className="toolbar-connection-name">{connectionName}</span>
            <span
                className={`status-dot status-${status}`}
                title={status}
                aria-label={status}
            />
            {ping !== null && (
                <span className="ping">{Math.round(ping)} ms</span>
            )}
            {status === 'disconnected'
                ? <>
                    <Button variant="ghost" onClick={onReconnect}>Reconnect</Button>
                    <Button variant="ghost" onClick={onNewConnection}>New Connection</Button>
                  </>
                : <Button variant="ghost" onClick={onDisconnect}>Disconnect</Button>
            }
        </div>
    );
}
