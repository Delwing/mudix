import { useEffect, useRef, useState, type ReactNode } from 'react';
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
    onOpenDocs: () => void;
    onOpenSettings: () => void;
    onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

function Icon({ children }: { children: ReactNode }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="toolbar-icon"
        >
            {children}
        </svg>
    );
}

const IconScripts = () => <Icon><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></Icon>;
const IconFiles = () => <Icon><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></Icon>;
const IconMap = () => <Icon><polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6" /><line x1="8" y1="3" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="21" /></Icon>;
const IconLogs = () => <Icon><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></Icon>;
const IconDocs = () => <Icon><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Icon>;
const IconSettings = () => <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Icon>;
const IconReconnect = () => <Icon><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></Icon>;
const IconDisconnect = () => <Icon><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></Icon>;
const IconCloseProfile = () => <Icon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Icon>;

export function Toolbar({ connectionName, status, ping, onDisconnect, onReconnect, onNewConnection, onOpenMap, onOpenScripts, onOpenFiles, onOpenLogs, onOpenDocs, onOpenSettings, onContextMenu }: ToolbarProps) {
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

    const isLive = status !== 'disconnected';
    const handleCloseProfile = () => {
        if (isLive) onDisconnect();
        onNewConnection();
    };

    const actions = (
        <>
            <Button variant="ghost" onClick={fire(onOpenScripts)}><IconScripts />Scripts</Button>
            <Button variant="ghost" onClick={fire(onOpenFiles)}><IconFiles />Files</Button>
            <Button variant="ghost" onClick={fire(onOpenMap)}><IconMap />Map</Button>
            <Button variant="ghost" onClick={fire(onOpenLogs)}><IconLogs />Logs</Button>
            <Button variant="ghost" onClick={fire(onOpenDocs)}><IconDocs />Docs</Button>
            <Button variant="ghost" onClick={fire(onOpenSettings)}><IconSettings />Settings</Button>
            <span className="toolbar-sep" aria-hidden="true" />
            {isLive
                ? <Button variant="ghost" className="toolbar-conn-btn" onClick={fire(onDisconnect)}><IconDisconnect />Disconnect</Button>
                : <Button variant="ghost" className="toolbar-conn-btn" onClick={fire(onReconnect)}><IconReconnect />Reconnect</Button>
            }
            <Button variant="ghost" onClick={fire(handleCloseProfile)}><IconCloseProfile />Close</Button>
        </>
    );

    return (
        <div className="mudix-toolbar" onContextMenu={onContextMenu}>
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
