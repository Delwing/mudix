import { createPortal } from 'react-dom';
import type { DragState, ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { ScriptWindow } from './ScriptWindow';

interface FloatingWindowLayerProps {
    windows: ScriptWindowRenderData[];
    manager: WindowManager;
    onDragStateChange: (ds: DragState | null) => void;
    onTitlebarContextMenu: (e: React.MouseEvent) => void;
}

export function FloatingWindowLayer({ windows, manager, onDragStateChange, onTitlebarContextMenu }: FloatingWindowLayerProps) {
    const floating = windows.filter(w => !w.docked);

    return createPortal(
        <div className="floating-window-root">
            {floating.map(w => w.visible && (
                <ScriptWindow
                    key={w.id}
                    {...w}
                    manager={manager}
                    isMiniConsole={manager.isMiniConsole(w.id)}
                    onFocus={()           => manager.bringToFront(w.id)}
                    onMoved={(x, y)       => manager.setPosition(w.id, x, y)}
                    onResized={(ww, h)    => manager.setSize(w.id, ww, h)}
                    onDock={(side, idx, stackTargetId, splitTargetId, splitBefore) =>
                        stackTargetId  ? manager.tabIntoGroup(w.id, stackTargetId)
                        : splitTargetId ? manager.splitIntoGroup(w.id, splitTargetId, splitBefore ?? false)
                        : manager.dock(w.id, side, idx)
                    }
                    onDragStateChange={onDragStateChange}
                    onTitlebarContextMenu={onTitlebarContextMenu}
                    onHide={()            => manager.hide(w.id)}
                />
            ))}
        </div>,
        document.body,
    );
}
