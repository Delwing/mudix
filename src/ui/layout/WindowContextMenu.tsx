import { ContextMenu } from '../components';
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
    const sorted = [...windows].sort((a, b) => a.title.localeCompare(b.title));

    return (
        <ContextMenu x={x} y={y} onClose={onClose}>
            {sorted.length === 0
                ? <div className="ctx-menu__empty">No windows</div>
                : sorted.map(w => (
                    <label key={w.id} className="ctx-menu__item">
                        <input
                            type="checkbox"
                            checked={w.visible}
                            onChange={() => w.visible ? manager.hide(w.id) : manager.show(w.id)}
                            style={{ cursor: 'pointer', flexShrink: 0, accentColor: 'var(--accent)' }}
                        />
                        <span>{w.title}</span>
                    </label>
                ))
            }
        </ContextMenu>
    );
}
