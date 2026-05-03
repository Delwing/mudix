import { useLayoutEffect, useRef } from 'react';
import type { DockSide, DragState } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { detectDock } from './dockDetect';

interface ScriptWindowProps {
    id: string;
    title: string;
    kind: 'text' | 'html' | 'map';
    visible: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    manager: WindowManager;
    onFocus:            () => void;
    onMoved:            (x: number, y: number) => void;
    onResized:          (w: number, h: number) => void;
    onDock:             (side: DockSide, slotIndex: number) => void;
    onDragStateChange:  (ds: DragState | null) => void;
    onClose:            () => void;
    onHide:             () => void;
}

export function ScriptWindow({
    id, title, visible,
    x, y, width, height, zIndex,
    manager,
    onFocus, onMoved, onResized, onDock, onDragStateChange, onClose, onHide,
}: ScriptWindowProps) {
    const windowRef  = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Attach the window's persistent portal-target div into our content slot.
    // useLayoutEffect runs before paint — no flash, and the panel's useEffect
    // (renderer setup) fires after attachment so layout measurements are correct.
    useLayoutEffect(() => {
        const slot   = contentRef.current;
        const target = manager.getPortalTarget(id);
        if (!slot || !target) return;
        slot.appendChild(target);
        return () => {
            if (target.parentNode === slot) slot.removeChild(target);
        };
    }, [manager, id]);

    // ── Title bar drag ────────────────────────────────────────────────────────

    const handleTitlebarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if ((e.target as Element).closest('.script-window-btn')) return;
        e.preventDefault();
        onFocus();

        const el = windowRef.current;
        if (!el) return;

        // Offset of the click within the window (container is position:fixed inset:0
        // so offsetLeft === viewport X, same coordinate space as clientX).
        const startOffsetX = e.clientX - el.offsetLeft;
        const startOffsetY = e.clientY - el.offsetTop;
        let lastX = el.offsetLeft;
        let lastY = el.offsetTop;
        let potentialDock: DockSide | null = null;
        let potentialSlot = 0;

        const onMove = (ev: PointerEvent) => {
            lastX = ev.clientX - startOffsetX;
            lastY = ev.clientY - startOffsetY;

            // Direct DOM update every frame for smooth drag.
            el.style.left = `${lastX}px`;
            el.style.top  = `${lastY}px`;

            const { side, slotIndex } = ev.shiftKey
                ? { side: null, slotIndex: 0 }
                : detectDock(ev.clientX, ev.clientY);

            if (side !== potentialDock || slotIndex !== potentialSlot) {
                potentialDock = side;
                potentialSlot = slotIndex;
                // Sync manager state BEFORE triggering re-render so React renders
                // the correct position when dock-zone indicator updates.
                onMoved(lastX, lastY);
                onDragStateChange(side
                    ? { panelId: id, potentialDock: side, insertSlotIndex: slotIndex }
                    : null);
            }
        };

        const onUp = () => {
            onDragStateChange(null);
            if (potentialDock !== null) {
                onDock(potentialDock, potentialSlot);
            } else {
                onMoved(lastX, lastY);
            }
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    };

    // ── Corner resize ─────────────────────────────────────────────────────────

    const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const el = windowRef.current;
        if (!el) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;
        let lastW = startW;
        let lastH = startH;

        const onMove = (ev: PointerEvent) => {
            lastW = Math.max(150, startW + (ev.clientX - startX));
            lastH = Math.max(80,  startH + (ev.clientY - startY));
            el.style.width  = `${lastW}px`;
            el.style.height = `${lastH}px`;
        };
        const onUp = () => {
            onResized(lastW, lastH);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    };

    return (
        <div
            ref={windowRef}
            className="script-window"
            data-window-id={id}
            style={{ left: x, top: y, width, height, zIndex, display: visible ? 'flex' : 'none' }}
            onPointerDown={onFocus}
        >
            <div className="script-window-titlebar" onPointerDown={handleTitlebarPointerDown}>
                <span className="script-window-title">{title}</span>
                <button className="script-window-btn" title="Hide"  onClick={onHide}>−</button>
                <button className="script-window-btn close" title="Close" onClick={onClose}>×</button>
            </div>
            <div className="script-window-content" ref={contentRef} />
            <div className="script-window-resize" onPointerDown={handleResizePointerDown} />
        </div>
    );
}
