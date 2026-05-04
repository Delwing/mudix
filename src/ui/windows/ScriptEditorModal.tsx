import { useRef, useState } from 'react';
import { ScriptEditorPanel } from './panels/ScriptEditorPanel';
import { useAppStore } from '../../storage';
import type { MudSession } from '../../mud/MudSession';
import type { ScriptNode } from '../../storage/schema';

const MIN_W = 500;
const MIN_H = 320;
const DEFAULT_W = 900;
const DEFAULT_H = 640;

interface Props {
    connectionId: string;
    session: MudSession;
    onScriptSave?: (script: ScriptNode) => void;
    onClose: () => void;
}

export function ScriptEditorModal({ connectionId, session, onScriptSave, onClose }: Props) {
    const savedBounds  = useAppStore(s => s.connectionScriptEditorBounds[connectionId]);
    const saveBounds   = useAppStore(s => s.saveScriptEditorBounds);

    const [bounds, setBounds] = useState(() => savedBounds ?? {
        x: Math.max(0, (window.innerWidth  - DEFAULT_W) / 2),
        y: Math.max(0, (window.innerHeight - DEFAULT_H) / 2),
        width:  DEFAULT_W,
        height: DEFAULT_H,
    });

    const dragRef    = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
    const resizeRef  = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
    const boundsRef  = useRef(bounds);
    boundsRef.current = bounds;

    const handleDragDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startY: e.clientY, originX: bounds.x, originY: bounds.y };

        const onMove = (me: MouseEvent) => {
            if (!dragRef.current) return;
            setBounds(b => {
                const next = {
                    ...b,
                    x: dragRef.current!.originX + me.clientX - dragRef.current!.startX,
                    y: dragRef.current!.originY + me.clientY - dragRef.current!.startY,
                };
                boundsRef.current = next;
                return next;
            });
        };

        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            saveBounds(connectionId, boundsRef.current);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handleResizeDown = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = { startX: e.clientX, startY: e.clientY, originW: bounds.width, originH: bounds.height };

        const onMove = (me: MouseEvent) => {
            if (!resizeRef.current) return;
            setBounds(b => {
                const next = {
                    ...b,
                    width:  Math.max(MIN_W, resizeRef.current!.originW + me.clientX - resizeRef.current!.startX),
                    height: Math.max(MIN_H, resizeRef.current!.originH + me.clientY - resizeRef.current!.startY),
                };
                boundsRef.current = next;
                return next;
            });
        };

        const onUp = () => {
            resizeRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            saveBounds(connectionId, boundsRef.current);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div
            className="script-editor-modal"
            style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
        >
            <div className="script-editor-modal__header" onMouseDown={handleDragDown}>
                <span className="script-editor-modal__title">Scripts</span>
                <button className="modal-close" onClick={onClose} type="button" aria-label="Close">✕</button>
            </div>
            <div className="script-editor-modal__body">
                <ScriptEditorPanel connectionId={connectionId} session={session} onScriptSave={onScriptSave} />
            </div>
            <div className="script-editor-modal__resize" onMouseDown={handleResizeDown} />
        </div>
    );
}
