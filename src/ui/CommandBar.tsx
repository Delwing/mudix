import { useEffect } from 'react';
import { Button, Input } from './components';

interface CommandBarProps {
    command: string;
    onCommandChange: (command: string) => void;
    connected: boolean;
    passwordMode?: boolean;
    commandInputRef: React.RefObject<HTMLInputElement>;
    onSubmit: () => void;
}

export function CommandBar({ command, onCommandChange, connected, passwordMode, commandInputRef, onSubmit }: CommandBarProps) {
    useEffect(() => {
        if (connected) {
            commandInputRef.current?.focus();
        }
    }, [connected, commandInputRef]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!connected) return;
        onSubmit();
    };

    return (
        <form className="command-bar" onSubmit={handleSubmit}>
            <span className="prompt">&gt;</span>
            <Input
                ref={commandInputRef}
                className="command-input"
                type={passwordMode ? 'password' : 'text'}
                value={command}
                onChange={e => onCommandChange(e.target.value)}
                placeholder={connected ? (passwordMode ? 'Enter password…' : 'Enter command…') : ''}
                disabled={!connected}
                autoComplete="off"
                spellCheck={false}
                aria-label="Command input"
            />
            <Button
                variant="secondary"
                type="submit"
                disabled={!connected}
            >
                Send
            </Button>
        </form>
    );
}
