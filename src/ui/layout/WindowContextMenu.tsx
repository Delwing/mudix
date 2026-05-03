import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';

interface WindowContextMenuProps {
    windows: ScriptWindowRenderData[];
    manager: WindowManager;
    x: number;
    y: number;
    onClose: () => void;
}

export function WindowContextMenu({ windows, manager, x, y, onClose }: WindowContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) onClose();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose]);

    const sorted = [...windows].sort((a, b) => a.title.localeCompare(b.title));

    return createPortal(
        <div ref={ref} className="window-context-menu" style={{ left: x, top: y }}>
            {sorted.length === 0
                ? <div className="window-context-menu-empty">No windows</div>
                : sorted.map(w => (
                    <label key={w.id} className="window-context-menu-item">
                        <input
                            type="checkbox"
                            checked={w.visible}
                            onChange={() => w.visible ? manager.hide(w.id) : manager.show(w.id)}
                        />
                        <span>{w.title}</span>
                    </label>
                ))
            }
        </div>,
        document.body,
    );
}
