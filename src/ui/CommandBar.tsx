import { useEffect, useState } from 'react';
import { Button, Input } from './components';
import type { CmdLineMenuEntry, CmdLineMenuRegistry } from './CmdLineMenuRegistry';

interface CommandBarProps {
    command: string;
    onCommandChange: (command: string) => void;
    passwordMode?: boolean;
    commandInputRef: React.RefObject<HTMLInputElement>;
    onSubmit: () => void;
    cmdLineMenu: CmdLineMenuRegistry;
}

export function CommandBar({ command, onCommandChange, passwordMode, commandInputRef, onSubmit, cmdLineMenu }: CommandBarProps) {
    const [menu, setMenu] = useState<{ x: number; y: number; items: CmdLineMenuEntry[] } | null>(null);

    useEffect(() => {
        commandInputRef.current?.focus();
    }, [commandInputRef]);

    useEffect(() => {
        if (!menu) return;
        const onDown = (e: MouseEvent) => {
            const root = document.getElementById('mudix-cmdline-menu');
            if (root && !root.contains(e.target as Node)) setMenu(null);
        };
        const onClose = () => setMenu(null);
        document.addEventListener('mousedown', onDown);
        window.addEventListener('resize', onClose);
        window.addEventListener('blur', onClose);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('blur', onClose);
        };
    }, [menu]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit();
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLInputElement>) => {
        const items = cmdLineMenu.list();
        if (items.length === 0) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, items });
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
                    onContextMenu={handleContextMenu}
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
            {menu && (
                <div
                    id="mudix-cmdline-menu"
                    className="map-context-menu"
                    style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {menu.items.map(item => (
                        <div
                            key={item.uniqueName}
                            className="map-context-menu-item"
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                cmdLineMenu.dispatch(item.uniqueName, command);
                                setMenu(null);
                            }}
                        >
                            <span className="map-context-menu-label">{item.displayName}</span>
                        </div>
                    ))}
                </div>
            )}
        </form>
    );
}
