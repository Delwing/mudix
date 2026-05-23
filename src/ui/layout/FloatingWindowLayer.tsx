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
            lockFloating={w.lockFloating}
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
    // moves/resizes for free. Main-parented miniconsoles portal into the main
    // output viewport so (0, 0) lands at the top of the gameplay area —
    // otherwise they'd render against `position: fixed` document coordinates
    // and overlap the app toolbar. Regular floating windows (no parent) still
    // render into the document-wide floating root so they can be dragged
    // freely across the viewport.
    const rootWindows: ScriptWindowRenderData[] = [];
    const nestedByParent = new Map<string, ScriptWindowRenderData[]>();
    const resolveParent = (w: ScriptWindowRenderData): { id: string; el: HTMLElement } | null => {
        const isMC = manager.isMiniConsole(w.id);
        const parent = w.parent;
        if (parent && parent !== 'main') {
            const el = manager.getViewport(parent);
            return el ? { id: parent, el } : null;
        }
        if (isMC) {
            const el = manager.getMainViewportElement();
            return el ? { id: 'main', el } : null;
        }
        return null;
    };
    for (const w of floating) {
        const resolved = resolveParent(w);
        if (resolved) {
            const list = nestedByParent.get(resolved.id) ?? [];
            list.push(w);
            nestedByParent.set(resolved.id, list);
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
                const target = parent === 'main'
                    ? manager.getMainViewportElement()!
                    : manager.getViewport(parent)!;
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
