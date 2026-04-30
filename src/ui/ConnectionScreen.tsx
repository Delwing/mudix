import { useState } from 'react';
import { Button, Input, FormField } from './components';
import type { MudConnection } from '../storage';

interface Props {
    connections: MudConnection[];
    connecting: boolean;
    connectingId: string | null;
    onConnect: (connection: MudConnection) => void;
    onAdd: (data: Omit<MudConnection, 'id'>) => void;
    onDelete: (id: string) => void;
}

export function ConnectionScreen({ connections, connecting, connectingId, onConnect, onAdd, onDelete }: Props) {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        const trimName = name.trim();
        const trimUrl = url.trim();
        if (!trimName || !trimUrl) return;
        onAdd({ name: trimName, url: trimUrl });
        setName('');
        setUrl('');
    };

    return (
        <div className="connection-screen">
            <div className="connection-panel">
                <div className="connection-brand">mudix</div>

                {connections.length > 0 && (
                    <div className="connection-list">
                        {connections.map(c => (
                            <div key={c.id} className="connection-card">
                                <div className="connection-info">
                                    <span className="connection-name">{c.name}</span>
                                    <span className="connection-addr">{c.url}</span>
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
                                        variant="icon"
                                        size="sm"
                                        onClick={() => onDelete(c.id)}
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

                <form className="connection-form" onSubmit={handleAdd}>
                    <div className="form-section-title">
                        {connections.length === 0 ? 'Add your first connection' : 'Add connection'}
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
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={!name.trim() || !url.trim() || connecting}
                    >
                        Add
                    </Button>
                </form>
            </div>
        </div>
    );
}
