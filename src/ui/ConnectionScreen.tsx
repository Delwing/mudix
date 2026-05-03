import { useState } from 'react';
import { Button, Input, FormField } from './components';
import { ProxyInfoModal } from './ProxyInfoModal';
import { DEFAULT_PROXY_URL, connectionDisplayAddr, type ConnectionMode, type MudConnection } from '../storage';

function buildPreviewUrl(host: string, port: string, proxyUrl: string): string {
    const base = (proxyUrl.trim() || DEFAULT_PROXY_URL).replace(/\/$/, '');
    const p = parseInt(port, 10);
    return `${base}?host=${encodeURIComponent(host.trim())}&port=${isNaN(p) ? 23 : p}`;
}

function modeOf(c: MudConnection): ConnectionMode {
    return c.mode ?? 'websocket';
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
    const [editingId, setEditingId] = useState<string | null>(null);
    const [mode, setMode] = useState<ConnectionMode>('mud');
    const [name, setName] = useState('');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('23');
    const [proxyUrl, setProxyUrl] = useState('');
    const [proxyModalOpen, setProxyModalOpen] = useState(false);
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
        return { name: name.trim(), mode: 'websocket', url: url.trim() };
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
                                        onClick={() => { if (editingId === c.id) resetForm(); onDelete(c.id); }}
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
                        <>
                            <div className="connection-host-row">
                                <FormField label="Host" htmlFor="cs-host">
                                    <Input
                                        id="cs-host"
                                        value={host}
                                        onChange={e => setHost(e.target.value)}
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
                            <div className="field">
                                <div className="proxy-label-row">
                                    <label className="field__label" htmlFor="cs-proxy">Proxy URL</label>
                                    <div className="proxy-label-actions">
                                        {proxyUrl && (
                                            <button type="button" className="proxy-reset-btn" onClick={() => setProxyUrl('')}>
                                                Use default
                                            </button>
                                        )}
                                        <button type="button" className="proxy-reset-btn" onClick={() => setProxyModalOpen(true)}>
                                            Host your own
                                        </button>
                                    </div>
                                </div>
                                <Input
                                    id="cs-proxy"
                                    value={proxyUrl}
                                    onChange={e => setProxyUrl(e.target.value)}
                                    placeholder={DEFAULT_PROXY_URL || 'wss://mudix-proxy.yourname.workers.dev'}
                                    spellCheck={false}
                                    noAutofill
                                />
                                <span className="proxy-hint">
                                    {proxyUrl
                                        ? 'Custom proxy'
                                        : DEFAULT_PROXY_URL
                                            ? `Default: ${DEFAULT_PROXY_URL}`
                                            : 'No default proxy configured'}
                                </span>
                            </div>
                            {host.trim() && (
                                <div className="proxy-url-preview">
                                    <span className="proxy-url-preview-label">Connects via</span>
                                    <code className="proxy-url-preview-url">{buildPreviewUrl(host, port, proxyUrl)}</code>
                                </div>
                            )}
                        </>
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
        {proxyModalOpen && <ProxyInfoModal onClose={() => setProxyModalOpen(false)} />}
        </>
    );
}
