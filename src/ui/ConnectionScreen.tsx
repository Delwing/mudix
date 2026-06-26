import { useState } from 'react';
import { Button, useConfirm } from './components';
import { ConnectionFormModal } from './ConnectionFormModal';
import { connectionDisplayAddr, type MudConnection } from '../storage';

/** Deterministic background color for a profile's name tile — same name always
 *  yields the same hue, so each profile gets a stable, distinct color. */
function avatarColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360} 42% 38%)`;
}

/** Shared canvas 2D context for measuring text width when fitting a name into
 *  the icon tile. Created lazily, reused across calls. */
let measureCtx: CanvasRenderingContext2D | null = null;

/** Largest font (px) at which `name` fits the tile on one line — mirrors
 *  Mudlet's customIcon(), which starts large and shrinks to a floor until the
 *  profile name fits the 120×30 box. */
function fitNameFontSize(name: string): number {
    const MAX = 18, MIN = 7, MAX_W = 110; // tile is 120px wide, minus padding
    if (typeof document === 'undefined') return 12;
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    if (!measureCtx) return 12;
    for (let size = MAX; size > MIN; size--) {
        measureCtx.font = `600 ${size}px sans-serif`;
        if (measureCtx.measureText(name).width <= MAX_W) return size;
    }
    return MIN;
}

/** Mudlet-style profile icon. Renders the custom icon when one is set
 *  (setProfileIcon), otherwise a colored tile with the profile name — matching
 *  Mudlet's behaviour of drawing the name onto profiles without an icon. */
function ProfileAvatar({ name, icon }: { name: string; icon?: string }) {
    if (icon) {
        return <img className="connection-avatar" src={icon} alt="" aria-hidden="true" />;
    }
    const label = name || '?';
    return (
        <span
            className="connection-avatar connection-avatar--name"
            style={{ backgroundColor: avatarColor(name) }}
            aria-hidden="true"
        >
            <span className="connection-avatar-text" style={{ fontSize: `${fitNameFontSize(label)}px` }}>
                {label}
            </span>
        </span>
    );
}

interface Props {
    connections: MudConnection[];
    connecting: boolean;
    connectingId: string | null;
    onConnect: (connection: MudConnection) => void;
    onOpen: (connection: MudConnection) => void;
    onAdd: (data: Omit<MudConnection, 'id'>) => string;
    onUpdate: (id: string, data: Omit<MudConnection, 'id'>) => void;
    onDelete: (id: string) => void;
    onOpenSettings: () => void;
}

export function ConnectionScreen({ connections, connecting, connectingId, onConnect, onOpen, onAdd, onUpdate, onDelete, onOpenSettings }: Props) {
    const confirm = useConfirm();
    // null = editor closed; { connection: null } = add a new one; { connection: c } = edit c.
    const [editor, setEditor] = useState<{ connection: MudConnection | null } | null>(null);

    const handleDelete = async (c: MudConnection) => {
        const ok = await confirm<boolean>({
            title: 'Delete profile?',
            tone: 'danger',
            message: (
                <>
                    Permanently delete <strong>{c.name}</strong>? Its scripts, aliases, triggers and saved layout
                    will be removed. This cannot be undone.
                </>
            ),
            buttons: [
                { label: 'Cancel', value: false, variant: 'secondary' },
                { label: 'Delete', value: true, variant: 'danger', autoFocus: true },
            ],
            dismissValue: false,
        });
        if (!ok) return;
        if (editor?.connection?.id === c.id) setEditor(null);
        onDelete(c.id);
    };

    return (
        <>
        <div className="connection-screen">
            <button className="connection-settings-btn" onClick={onOpenSettings} type="button" aria-label="Settings">
                ⚙
            </button>
            <div className="connection-panel">
                <div className="connection-brand">mudix</div>

                {connections.length > 0 && (
                    <div className="connection-list">
                        {connections.map(c => (
                            <div key={c.id} className="connection-card">
                                <ProfileAvatar name={c.name} icon={c.icon} />
                                <div className="connection-info">
                                    <span className="connection-name">{c.name}</span>
                                    <span className="connection-addr">{connectionDisplayAddr(c)}</span>
                                </div>
                                <div className="connection-actions">
                                    <Button
                                        variant="primary"
                                        onClick={() => onConnect(c)}
                                        disabled={connecting}
                                    >
                                        {connectingId === c.id ? 'Connecting…' : 'Connect'}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="md"
                                        onClick={() => onOpen(c)}
                                        disabled={connecting}
                                        title="Open profile offline"
                                    >
                                        Open
                                    </Button>
                                    <Button
                                        variant="icon"
                                        size="sm"
                                        onClick={() => setEditor({ connection: c })}
                                        disabled={connecting}
                                        aria-label="Edit connection"
                                        title="Edit"
                                    >
                                        ✎
                                    </Button>
                                    <Button
                                        variant="icon"
                                        size="sm"
                                        onClick={() => { void handleDelete(c); }}
                                        disabled={connecting}
                                        aria-label="Delete connection"
                                        title="Delete"
                                    >
                                        ×
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Button
                    variant="secondary"
                    className="connection-add-btn"
                    onClick={() => setEditor({ connection: null })}
                    disabled={connecting}
                >
                    + Add connection
                </Button>
            </div>
        </div>
        {editor && (
            <ConnectionFormModal
                connection={editor.connection}
                firstConnection={connections.length === 0}
                busy={connecting}
                onAdd={onAdd}
                onUpdate={onUpdate}
                onClose={() => setEditor(null)}
            />
        )}
        </>
    );
}
