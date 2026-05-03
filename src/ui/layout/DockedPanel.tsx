import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { DockSide, DragState } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { detectDock } from './dockDetect';

const DRAG_THRESHOLD = 5;

interface DockedPanelProps {
    id: string;
    title: string;
    kind: 'text' | 'html' | 'map';
    manager: WindowManager;
    onHide: () => void;
    onDragStateChange: (ds: DragState | null) => void;
    onTitlebarContextMenu: (e: React.MouseEvent) => void;
}

export function DockedPanel({ id, title, manager, onHide, onDragStateChange, onTitlebarContextMenu }: DockedPanelProps) {
    const panelRef  = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Attach the window's persistent portal-target div into our content slot.
    // useLayoutEffect runs before paint so there is no visible flash.
    // The cleanup removes it without destroying it — the target will be reattached
    // by whichever shell mounts next (ScriptWindow on undock, another DockedPanel on redock).
    useLayoutEffect(() => {
        const slot   = contentRef.current;
        const target = manager.getPortalTarget(id);
        if (!slot || !target) return;
        slot.appendChild(target);
        return () => {
            if (target.parentNode === slot) slot.removeChild(target);
        };
    }, [manager, id]);

    const handleTitlebarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if ((e.target as Element).closest('.script-window-btn')) return;
        e.preventDefault();

        const startX   = e.clientX;
        const startY   = e.clientY;
        // Capture click offset within the panel before it unmounts.
        const panelRect = panelRef.current?.getBoundingClientRect();
        const offsetX   = panelRect ? e.clientX - panelRect.left : 50;
        const offsetY   = panelRect ? e.clientY - panelRect.top  : 14;

        let hasDragged = false;
        let floatingEl: HTMLElement | null = null;
        let lastX = panelRect?.left ?? 0;
        let lastY = panelRect?.top  ?? 0;
        let potentialDock: DockSide | null = null;
        let potentialSlot = 0;
        let potentialStackTarget: string | undefined;
        let potentialSplitTarget: string | undefined;
        let potentialSplitBefore: boolean | undefined;

        const onMove = (ev: PointerEvent) => {
            if (!hasDragged) {
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_THRESHOLD) return;
                hasDragged = true;

                // Capture visual size + screen position before unmounting.
                const el      = panelRef.current;
                const rect    = el?.getBoundingClientRect();
                const visualW = el?.offsetWidth;
                const visualH = el?.offsetHeight;

                // Undock: floating window appears at the exact screen position of the docked panel.
                flushSync(() => {
                    manager.undock(id, visualW, visualH, rect?.left, rect?.top);
                });

                floatingEl = document.querySelector<HTMLElement>(`[data-window-id="${id}"]`);
                if (floatingEl) {
                    lastX = floatingEl.offsetLeft;
                    lastY = floatingEl.offsetTop;
                }
                return;
            }

            if (!floatingEl) return;

            lastX = ev.clientX - offsetX;
            lastY = ev.clientY - offsetY;

            // Direct DOM update for smooth drag.
            floatingEl.style.left = `${lastX}px`;
            floatingEl.style.top  = `${lastY}px`;

            const { side, slotIndex, stackTargetId, splitTargetId, splitBefore } = ev.shiftKey
                ? { side: null, slotIndex: 0, stackTargetId: undefined, splitTargetId: undefined, splitBefore: undefined }
                : detectDock(ev.clientX, ev.clientY);

            if (side !== potentialDock || slotIndex !== potentialSlot || stackTargetId !== potentialStackTarget || splitTargetId !== potentialSplitTarget) {
                potentialDock        = side;
                potentialSlot        = slotIndex;
                potentialStackTarget = stackTargetId;
                potentialSplitTarget = splitTargetId;
                potentialSplitBefore = splitBefore;
                manager.setPosition(id, lastX, lastY);
                onDragStateChange(side
                    ? { panelId: id, potentialDock: side, insertSlotIndex: slotIndex, stackTargetId, splitTargetId, splitBefore }
                    : null);
            }
        };

        const onUp = () => {
            onDragStateChange(null);
            if (hasDragged) {
                if (potentialDock !== null) {
                    if (potentialStackTarget) {
                        manager.tabIntoGroup(id, potentialStackTarget);
                    } else if (potentialSplitTarget) {
                        manager.splitIntoGroup(id, potentialSplitTarget, potentialSplitBefore ?? false);
                    } else {
                        manager.dock(id, potentialDock, potentialSlot);
                    }
                } else if (floatingEl) {
                    manager.setPosition(id, lastX, lastY);
                }
            }
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    };

    return (
        <div ref={panelRef} className="docked-panel" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <div className="docked-panel-titlebar" onPointerDown={handleTitlebarPointerDown} onContextMenu={onTitlebarContextMenu}>
                <span className="docked-panel-title">{title}</span>
                <button className="script-window-btn close" title="Close" onClick={onHide}>×</button>
            </div>
            <div className="docked-panel-content" ref={contentRef} />
        </div>
    );
}
