import { useState } from 'react';
import { Button, Input, FormField, useConfirm } from './components';
import { ProxyInfoModal } from './ProxyInfoModal';
import { ProxyWhyModal } from './ProxyWhyModal';
import { DEFAULT_PROXY_URL, connectionDisplayAddr, useAppStore, type ConnectionMode, type MudConnection } from '../storage';

function buildPreviewUrl(host: string, port: string, proxyUrl: string, fallback: string): string {
    const base = (proxyUrl.trim() || fallback).replace(/\/$/, '');
    const p = parseInt(port, 10);
    return `${base}?host=${encodeURIComponent(host.trim())}&port=${isNaN(p) ? 23 : p}`;
}

function modeOf(c: MudConnection): ConnectionMode {
    return c.mode ?? 'websocket';
}

/** Split a host string that may carry a trailing port (`host:port` or
 *  `host port`) into its parts, so pasting a full address moves the port into
 *  the Port field. Returns `port: undefined` when no trailing numeric port is
 *  present, leaving the Port field untouched. */
function splitHostPort(value: string): { host: string; port?: string } {
    const match = value.trim().match(/^(.*?)[\s:]+(\d+)$/);
    if (match && match[1].trim() !== '') {
        return { host: match[1].trim(), port: match[2] };
    }
    return { host: value };
}

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
    onAdd: (data: Omit<MudConnection, 'id'>) => void;
    onUpdate: (id: string, data: Omit<MudConnection, 'id'>) => void;
    onDelete: (id: string) => void;
    onOpenSettings: () => void;
}

export function ConnectionScreen({ connections, connecting, connectingId, onConnect, onOpen, onAdd, onUpdate, onDelete, onOpenSettings }: Props) {
    const confirm = useConfirm();
    // User's own deployed proxy (saved by ProxyWizardModal). When set, it takes
    // precedence over DEFAULT_PROXY_URL as the suggested default for new connections.
    const userProxyUrl = useAppStore(s => s.client.userProxyUrl);
    const profiles = useAppStore(s => s.connectionProfile);
    const effectiveDefaultProxy = userProxyUrl || DEFAULT_PROXY_URL;
    const [editingId, setEditingId] = useState<string | null>(null);
    const [mode, setMode] = useState<ConnectionMode>('mud');
    const [name, setName] = useState('');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('23');
    const [proxyUrl, setProxyUrl] = useState('');
    const [proxyModalOpen, setProxyModalOpen] = useState(false);
    const [proxyWhyOpen, setProxyWhyOpen] = useState(false);
    const [url, setUrl] = useState('');

    const isEditing = editingId !== null;

    const resetForm = () => {
        setEditingId(null);
        setMode('mud');
        setName('');
        setHost('');
        setPort('23');
        setProxyUrl('');
        setUrl('');
    };

    const startEdit = (c: MudConnection) => {
        setEditingId(c.id);
        setMode(modeOf(c));
        setName(c.name);
        setHost(c.host ?? '');
        setPort(String(c.port ?? 23));
        setProxyUrl(c.proxyUrl ?? '');
        setUrl(c.url ?? '');
    };

    const canSubmit = mode === 'mud'
        ? name.trim() !== '' && host.trim() !== ''
        : name.trim() !== '' && url.trim() !== '';

    const buildData = (): Omit<MudConnection, 'id'> => {
        if (mode === 'mud') {
            const parsedPort = parseInt(port, 10);
            return {
                name: name.trim(),
                mode: 'mud',
                host: host.trim(),
                port: isNaN(parsedPort) ? 23 : parsedPort,
                proxyUrl: proxyUrl.trim() || undefined,
            };
        }
        return {
            name: name.trim(),
            mode: 'websocket',
            url: url.trim(),
            proxyUrl: proxyUrl.trim() || undefined,
        };
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        if (isEditing) {
            onUpdate(editingId, buildData());
        } else {
            onAdd(buildData());
        }
        resetForm();
    };

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
        if (editingId === c.id) resetForm();
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
                            <div key={c.id} className={`connection-card${editingId === c.id ? ' connection-card--editing' : ''}`}>
                                <ProfileAvatar name={c.name} icon={profiles[c.id]?.icon} />
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
                                        onClick={() => editingId === c.id ? resetForm() : startEdit(c)}
                                        disabled={connecting}
                                        aria-label={editingId === c.id ? 'Cancel edit' : 'Edit connection'}
                                        title={editingId === c.id ? 'Cancel' : 'Edit'}
                                    >
                                        {editingId === c.id ? '↩' : '✎'}
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

                <form className="connection-form" onSubmit={handleSubmit}>
                    <div className="form-section-title">
                        {isEditing ? 'Edit connection' : connections.length === 0 ? 'Add your first connection' : 'Add connection'}
                    </div>

                    <div className="connection-mode-toggle">
                        <button
                            type="button"
                            className={`connection-mode-btn${mode === 'mud' ? ' active' : ''}`}
                            onClick={() => setMode('mud')}
                        >
                            MUD Server
                        </button>
                        <button
                            type="button"
                            className={`connection-mode-btn${mode === 'websocket' ? ' active' : ''}`}
                            onClick={() => setMode('websocket')}
                        >
                            WebSocket
                        </button>
                    </div>

                    <FormField label="Name" htmlFor="cs-name">
                        <Input
                            id="cs-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="My MUD"
                            spellCheck={false}
                            noAutofill
                        />
                    </FormField>

                    {mode === 'mud' ? (
                        <div className="connection-host-row">
                            <FormField label="Host" htmlFor="cs-host">
                                <Input
                                    id="cs-host"
                                    value={host}
                                    onChange={e => {
                                        const { host: h, port: p } = splitHostPort(e.target.value);
                                        setHost(h);
                                        if (p !== undefined) setPort(p);
                                    }}
                                    placeholder="mud.example.com"
                                    spellCheck={false}
                                    noAutofill
                                />
                            </FormField>
                            <FormField label="Port" htmlFor="cs-port">
                                <Input
                                    id="cs-port"
                                    value={port}
                                    onChange={e => setPort(e.target.value)}
                                    placeholder="23"
                                    spellCheck={false}
                                    noAutofill
                                />
                            </FormField>
                        </div>
                    ) : (
                        <FormField label="URL" htmlFor="cs-url">
                            <Input
                                id="cs-url"
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                                placeholder="wss://mud.example.com:4000"
                                spellCheck={false}
                                noAutofill
                            />
                        </FormField>
                    )}

                    <div className="field">
                        <div className="proxy-label-row">
                            <label className="field__label" htmlFor="cs-proxy">Proxy URL</label>
                            <div className="proxy-label-actions">
                                {proxyUrl && (
                                    <button type="button" className="proxy-reset-btn" onClick={() => setProxyUrl('')}>
                                        Use default
                                    </button>
                                )}
                                <button type="button" className="proxy-reset-btn" onClick={() => setProxyWhyOpen(true)}>
                                    Why do I need that?
                                </button>
                                <button type="button" className="proxy-reset-btn" onClick={() => setProxyModalOpen(true)}>
                                    Host your own
                                </button>
                            </div>
                        </div>
                        <Input
                            id="cs-proxy"
                            value={proxyUrl}
                            onChange={e => setProxyUrl(e.target.value)}
                            placeholder={effectiveDefaultProxy || 'wss://mudix-proxy.yourname.workers.dev'}
                            spellCheck={false}
                            noAutofill
                        />
                        <span className="proxy-hint">
                            {mode === 'websocket'
                                ? 'Used for HTTP requests blocked by CORS'
                                : proxyUrl
                                    ? 'Custom proxy'
                                    : userProxyUrl
                                        ? `Your proxy: ${userProxyUrl}`
                                        : DEFAULT_PROXY_URL
                                            ? `Default: ${DEFAULT_PROXY_URL}`
                                            : 'No default proxy configured'}
                        </span>
                    </div>

                    {mode === 'mud' && host.trim() && (
                        <div className="proxy-url-preview">
                            <span className="proxy-url-preview-label">Connects via</span>
                            <code className="proxy-url-preview-url">{buildPreviewUrl(host, port, proxyUrl, effectiveDefaultProxy)}</code>
                        </div>
                    )}

                    <div className="connection-form-actions">
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={!canSubmit || connecting}
                        >
                            {isEditing ? 'Save' : 'Add'}
                        </Button>
                        {isEditing && (
                            <Button type="button" variant="secondary" onClick={resetForm}>
                                Cancel
                            </Button>
                        )}
                    </div>
                </form>
            </div>
        </div>
        {proxyModalOpen && (
            <ProxyInfoModal
                onClose={() => setProxyModalOpen(false)}
                onUseProxy={(url) => setProxyUrl(url)}
            />
        )}
        {proxyWhyOpen && (
            <ProxyWhyModal
                onClose={() => setProxyWhyOpen(false)}
                onHostYourOwn={() => { setProxyWhyOpen(false); setProxyModalOpen(true); }}
            />
        )}
        </>
    );
}
