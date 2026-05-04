import { Button } from './components';
import type { SessionStatus } from '../mud/events';

interface ToolbarProps {
    connectionName: string;
    status: SessionStatus;
    ping: number | null;
    onDisconnect: () => void;
    onReconnect: () => void;
    onNewConnection: () => void;
    onOpenMap: () => void;
    onOpenScripts: () => void;
    onOpenFiles: () => void;
    onOpenSettings: () => void;
    onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function Toolbar({ connectionName, status, ping, onDisconnect, onReconnect, onNewConnection, onOpenMap, onOpenScripts, onOpenFiles, onOpenSettings, onContextMenu }: ToolbarProps) {
    return (
        <div className="toolbar" onContextMenu={onContextMenu}>
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
            <Button variant="ghost" onClick={onOpenScripts}>Scripts</Button>
            <Button variant="ghost" onClick={onOpenFiles}>Files</Button>
            <Button variant="ghost" onClick={onOpenMap}>Map</Button>
            <Button variant="ghost" onClick={onOpenSettings}>Settings</Button>
            {status === 'disconnected'
                ? <>
                    <Button variant="ghost" onClick={onReconnect}>Reconnect</Button>
                    <Button variant="ghost" onClick={onNewConnection}>Close Profile</Button>
                  </>
                : <Button variant="ghost" onClick={onDisconnect}>Disconnect</Button>
            }
        </div>
    );
}
