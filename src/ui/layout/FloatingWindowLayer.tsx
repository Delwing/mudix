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

    const renderWindow = (w: ScriptWindowRenderData) => w.visible && (
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
    );

    // Mudlet createMiniConsole(parent, name, ...) nests the miniconsole inside
    // a parent userwindow. We portal those into the parent's viewport so their
    // (x, y) are interpreted relative to the parent, and they follow parent
    // moves/resizes for free. Parents that haven't mounted yet (or 'main',
    // which equals the document viewport anyway) fall back to the floating
    // root — main-parented miniconsoles render correctly there since main
    // already spans the viewport.
    const rootWindows: ScriptWindowRenderData[] = [];
    const nestedByParent = new Map<string, ScriptWindowRenderData[]>();
    for (const w of floating) {
        const parent = w.parent;
        if (parent && parent !== 'main' && manager.getViewport(parent)) {
            const list = nestedByParent.get(parent) ?? [];
            list.push(w);
            nestedByParent.set(parent, list);
        } else {
            rootWindows.push(w);
        }
    }

    return (
        <>
            {createPortal(
                <div className="floating-window-root">
                    {rootWindows.map(renderWindow)}
                </div>,
                document.body,
            )}
            {[...nestedByParent.entries()].map(([parent, list]) => {
                const target = manager.getViewport(parent)!;
                return createPortal(
                    <div className="floating-window-root floating-window-root--nested">
                        {list.map(renderWindow)}
                    </div>,
                    target,
                    `nested:${parent}`,
                );
            })}
        </>
    );
}
