import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface OutputContextMenuProps {
    x: number;
    y: number;
    showTimestamps: boolean;
    onToggleTimestamps: () => void;
    onClose: () => void;
}

export function OutputContextMenu({
    x,
    y,
    showTimestamps,
    onToggleTimestamps,
    onClose,
}: OutputContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handlePointerDown = (e: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="output-context-menu"
            style={{ left: x, top: y }}
            onContextMenu={e => e.preventDefault()}
        >
            <button
                className="output-context-menu-item"
                type="button"
                onClick={() => { onToggleTimestamps(); onClose(); }}
            >
                <span className="output-context-menu-check">{showTimestamps ? '✓' : ''}</span>
                Show timestamps
            </button>
        </div>,
        document.body,
    );
}
