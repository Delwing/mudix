import { useEffect } from 'react';

interface CommandBarProps {
    command: string;
    onCommandChange: (command: string) => void;
    connected: boolean;
    commandInputRef: React.RefObject<HTMLInputElement>;
    onSubmit: () => void;
}

export function CommandBar({ command, onCommandChange, connected, commandInputRef, onSubmit }: CommandBarProps) {
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
            <input
                ref={commandInputRef}
                className="command-input"
                value={command}
                onChange={e => onCommandChange(e.target.value)}
                placeholder={connected ? 'Enter command…' : ''}
                disabled={!connected}
                autoComplete="off"
                spellCheck={false}
                aria-label="Command input"
            />
            <button
                className="btn btn-send"
                type="submit"
                disabled={!connected || !command.trim()}
            >
                Send
            </button>
        </form>
    );
}
