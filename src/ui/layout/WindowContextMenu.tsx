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
                    <div key={w.id} className="ctx-menu__item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                            type="checkbox"
                            checked={w.visible}
                            onChange={() => w.visible ? manager.hide(w.id) : manager.show(w.id)}
                            style={{ cursor: 'pointer', flexShrink: 0, accentColor: 'var(--accent)' }}
                        />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                        <button
                            type="button"
                            className="ctx-menu__action"
                            title={w.poppedOut ? 'Pop back into main window' : 'Pop out to a separate window'}
                            onClick={() => { w.poppedOut ? manager.popIn(w.id) : manager.popOut(w.id); onClose(); }}
                            style={{ flexShrink: 0, cursor: 'pointer' }}
                        >
                            {w.poppedOut ? 'Pop in' : 'Pop out'}
                        </button>
                    </div>
                ))
            }
        </ContextMenu>
    );
}
