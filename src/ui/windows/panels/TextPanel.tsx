import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { WindowManager } from '../WindowManager';
import { useTextPanelOutput } from '../../../hooks/useOutput';

interface TextPanelParams {
    manager: WindowManager;
}

const DEFAULT_STICKY_HEIGHT = 120;
const MIN_STICKY_HEIGHT = 40;

export function TextPanel(props: IDockviewPanelProps<TextPanelParams>) {
    const { manager } = props.params;
    const id = props.api.id;

    const [stickyHeight, setStickyHeight] = useState(DEFAULT_STICKY_HEIGHT);
    const stickyOuterRef = useRef<HTMLDivElement>(null);

    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom, controls } =
        useTextPanelOutput({
            stickyLines: 50,
            onCursorReady: (ops) => manager.registerCursor(id, ops),
        });

    useEffect(() => {
        const outer = stickyOuterRef.current;
        const output = outputRef.current;
        if (!outer || !output) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            output.scrollTop += e.deltaY;
        };
        outer.addEventListener('wheel', onWheel, { passive: false });
        return () => outer.removeEventListener('wheel', onWheel);
    }, [outputRef]);

    useEffect(() => {
        if (!controls || !outputRef.current) return;
        manager.registerTextPanel(id, controls, outputRef.current);
        return () => manager.unregister(id);
    }, [manager, id, controls]);

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startHeight = stickyHeight;
        const maxHeight = Math.floor((stickyOuterRef.current?.parentElement?.clientHeight ?? 400) * 0.8);
        const onMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY;
            setStickyHeight(Math.max(MIN_STICKY_HEIGHT, Math.min(startHeight + delta, maxHeight)));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    return (
        <div className="output-container window-text-panel">
            <div className="output-wrapper" ref={outputRef}>
                <div ref={sentinelRef} style={{ height: 0 }} />
            </div>

            {isSplitView && (
                <div
                    className="output-sticky-handle"
                    style={{ bottom: stickyHeight }}
                    onMouseDown={handleResizeStart}
                />
            )}

            <div
                className={`output-sticky${isSplitView ? ' output-sticky--active' : ''}`}
                ref={stickyOuterRef}
                style={{ height: stickyHeight }}
            >
                <div className="output-sticky-content" ref={stickyAreaRef} />
            </div>

            {isSplitView && (
                <button
                    className="scroll-to-bottom"
                    style={{ bottom: stickyHeight + 8 }}
                    onClick={scrollToBottom}
                    type="button"
                    aria-label="Scroll to bottom"
                >
                    ↓ new output
                </button>
            )}
        </div>
    );
}
