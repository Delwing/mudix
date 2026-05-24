import { useEffect, useRef, useState } from 'react';
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
    onOpenLogs: () => void;
    onOpenSettings: () => void;
    onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function Toolbar({ connectionName, status, ping, onDisconnect, onReconnect, onNewConnection, onOpenMap, onOpenScripts, onOpenFiles, onOpenLogs, onOpenSettings, onContextMenu }: ToolbarProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const hamburgerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onDocPointer = (e: PointerEvent) => {
            if (!hamburgerRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('pointerdown', onDocPointer);
        return () => document.removeEventListener('pointerdown', onDocPointer);
    }, [menuOpen]);

    const fire = (cb: () => void) => () => { setMenuOpen(false); cb(); };

    const actions = (
        <>
            <Button variant="ghost" onClick={fire(onOpenScripts)}>Scripts</Button>
            <Button variant="ghost" onClick={fire(onOpenFiles)}>Files</Button>
            <Button variant="ghost" onClick={fire(onOpenMap)}>Map</Button>
            <Button variant="ghost" onClick={fire(onOpenLogs)}>Logs</Button>
            <Button variant="ghost" onClick={fire(onOpenSettings)}>Settings</Button>
            {status === 'disconnected'
                ? <>
                    <Button variant="ghost" onClick={fire(onReconnect)}>Reconnect</Button>
                    <Button variant="ghost" onClick={fire(onNewConnection)}>Close Profile</Button>
                  </>
                : <Button variant="ghost" onClick={fire(onDisconnect)}>Disconnect</Button>
            }
        </>
    );

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
            <div className="toolbar-actions">{actions}</div>
            <div className="toolbar-hamburger" ref={hamburgerRef}>
                <button
                    type="button"
                    className="toolbar-hamburger-btn"
                    onClick={() => setMenuOpen(v => !v)}
                    aria-label="Menu"
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                >
                    <span /><span /><span />
                </button>
                {menuOpen && (
                    <div className="toolbar-hamburger-menu" role="menu">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
}
