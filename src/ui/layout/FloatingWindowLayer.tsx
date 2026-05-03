import { createPortal } from 'react-dom';
import type { DragState, ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { ScriptWindow } from './ScriptWindow';

interface FloatingWindowLayerProps {
    windows: ScriptWindowRenderData[];
    manager: WindowManager;
    onDragStateChange: (ds: DragState | null) => void;
}

export function FloatingWindowLayer({ windows, manager, onDragStateChange }: FloatingWindowLayerProps) {
    const floating = windows.filter(w => !w.docked);

    return createPortal(
        <div className="floating-window-root">
            {floating.map(w => w.visible && (
                <ScriptWindow
                    key={w.id}
                    {...w}
                    manager={manager}
                    onFocus={()           => manager.bringToFront(w.id)}
                    onMoved={(x, y)       => manager.setPosition(w.id, x, y)}
                    onResized={(ww, h)    => manager.setSize(w.id, ww, h)}
                    onDock={(side, idx)   => manager.dock(w.id, side, idx)}
                    onDragStateChange={onDragStateChange}
                    onClose={()           => manager.close(w.id)}
                    onHide={()            => manager.hide(w.id)}
                />
            ))}
        </div>,
        document.body,
    );
}
