import { useRef, useState } from 'react';
import type { ModalBounds } from '../storage/schema';

type ResizeDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const DIRS: ResizeDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

interface ResizableModalProps {
    title: string;
    onClose: () => void;
    savedBounds?: ModalBounds | null;
    onBoundsChange?: (bounds: ModalBounds) => void;
    minW?: number;
    minH?: number;
    defaultW: number;
    defaultH: number;
    headerExtra?: React.ReactNode;
    className?: string;
    bodyClassName?: string;
    children: React.ReactNode;
}

export function ResizableModal({
    title,
    onClose,
    savedBounds,
    onBoundsChange,
    minW = 200,
    minH = 150,
    defaultW,
    defaultH,
    headerExtra,
    className,
    bodyClassName,
    children,
}: ResizableModalProps) {
    const [bounds, setBounds] = useState<ModalBounds>(() => savedBounds ?? {
        x: Math.max(0, (window.innerWidth  - defaultW) / 2),
        y: Math.max(0, (window.innerHeight - defaultH) / 2),
        width:  defaultW,
        height: defaultH,
    });

    const boundsRef = useRef(bounds);
    boundsRef.current = bounds;

    const commit = () => onBoundsChange?.(boundsRef.current);

    const handleDragDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const { x: ox, y: oy } = boundsRef.current;
        const sx = e.clientX, sy = e.clientY;

        const onMove = (me: MouseEvent) => {
            const next = { ...boundsRef.current, x: ox + me.clientX - sx, y: oy + me.clientY - sy };
            boundsRef.current = next;
            setBounds(next);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            commit();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handleResizeDown = (e: React.MouseEvent, dir: ResizeDir) => {
        e.preventDefault();
        e.stopPropagation();
        const { x: ox, y: oy, width: ow, height: oh } = boundsRef.current;
        const sx = e.clientX, sy = e.clientY;

        const onMove = (me: MouseEvent) => {
            const dx = me.clientX - sx, dy = me.clientY - sy;
            let nx = ox, ny = oy, nw = ow, nh = oh;
            if (dir.includes('e')) nw = Math.max(minW, ow + dx);
            if (dir.includes('s')) nh = Math.max(minH, oh + dy);
            if (dir.includes('w')) { nw = Math.max(minW, ow - dx); nx = ox + ow - nw; }
            if (dir.includes('n')) { nh = Math.max(minH, oh - dy); ny = oy + oh - nh; }
            const next = { x: nx, y: ny, width: nw, height: nh };
            boundsRef.current = next;
            setBounds(next);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            commit();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div
            className={`resizable-modal${className ? ` ${className}` : ''}`}
            style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
        >
            <div className="resizable-modal__header" onMouseDown={handleDragDown}>
                <span className="resizable-modal__title">{title}</span>
                <div className="resizable-modal__header-actions">
                    {headerExtra}
                    <button className="modal-close" onClick={onClose} type="button" aria-label="Close">✕</button>
                </div>
            </div>
            <div className={`resizable-modal__body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
                {children}
            </div>
            {DIRS.map(dir => (
                <div
                    key={dir}
                    className={`resizable-modal__resize resizable-modal__resize--${dir}`}
                    onMouseDown={e => handleResizeDown(e, dir)}
                />
            ))}
        </div>
    );
}
