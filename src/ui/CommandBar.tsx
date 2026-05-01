import { useEffect } from 'react';
import { Button, Input } from './components';

interface CommandBarProps {
    command: string;
    onCommandChange: (command: string) => void;
    passwordMode?: boolean;
    commandInputRef: React.RefObject<HTMLInputElement>;
    onSubmit: () => void;
}

export function CommandBar({ command, onCommandChange, passwordMode, commandInputRef, onSubmit }: CommandBarProps) {
    useEffect(() => {
        commandInputRef.current?.focus();
    }, [commandInputRef]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit();
    };

    return (
        <form className="command-bar" onSubmit={handleSubmit}>
            <div className="command-input-wrap">
                <span className="prompt" aria-hidden="true">&gt;</span>
                <Input
                    ref={commandInputRef}
                    className="command-input"
                    type={passwordMode ? 'password' : 'text'}
                    value={command}
                    onChange={e => onCommandChange(e.target.value)}
                    placeholder={passwordMode ? 'Enter password…' : 'Enter command…'}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Command input"
                />
            </div>
            <Button
                variant="secondary"
                type="submit"
            >
                Send
            </Button>
        </form>
    );
}
