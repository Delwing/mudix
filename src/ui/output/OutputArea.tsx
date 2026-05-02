import { useState, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import { useOutputArea, DEFAULT_STICKY_LINES } from '../../hooks/useOutput';
import { useAppStore } from '../../storage';
import { OutputContextMenu } from './OutputContextMenu';

interface OutputAreaProps {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

interface ContextMenuState {
    x: number;
    y: number;
}

const DEFAULT_STICKY_HEIGHT = 160;
const MIN_STICKY_HEIGHT = 40;

export function OutputArea({ session, stickyLines = DEFAULT_STICKY_LINES, commandInputRef }: OutputAreaProps) {
    const outputBackground = useAppStore(s => s.ui.outputBackground);
    const showTimestamps = useAppStore(s => s.ui.showTimestamps);
    const patchUI = useAppStore(s => s.patchUI);

    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [stickyHeight, setStickyHeight] = useState(DEFAULT_STICKY_HEIGHT);

    const stickyOuterRef = useRef<HTMLDivElement>(null);

    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom } =
        useOutputArea(session, { stickyLines, showTimestamps });

    // Forward wheel and touch events from the live area to the history scroller.
    useEffect(() => {
        const outer = stickyOuterRef.current;
        const output = outputRef.current;
        if (!outer || !output) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            output.scrollTop += e.deltaY;
        };

        let touchStartY = 0;
        const onTouchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY; };
        const onTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            const deltaY = touchStartY - e.touches[0].clientY;
            output.scrollTop += deltaY;
            touchStartY = e.touches[0].clientY;
        };

        outer.addEventListener('wheel', onWheel, { passive: false });
        outer.addEventListener('touchstart', onTouchStart, { passive: true });
        outer.addEventListener('touchmove', onTouchMove, { passive: false });
        return () => {
            outer.removeEventListener('wheel', onWheel);
            outer.removeEventListener('touchstart', onTouchStart);
            outer.removeEventListener('touchmove', onTouchMove);
        };
    }, [outputRef]);

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!commandInputRef) return;
        const target = e.target as Element;
        if (!target.closest('a, button, input, select, textarea')) {
            commandInputRef.current?.focus();
        }
    };

    const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startHeight = stickyHeight;
        const maxHeight = Math.floor((stickyOuterRef.current?.parentElement?.clientHeight ?? 800) * 0.8);

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
        <div className="output-container" onClick={handleClick}>
            <div
                className="output-wrapper"
                ref={outputRef}
                style={outputBackground ? { background: outputBackground } : undefined}
                onContextMenu={handleContextMenu}
            >
                {/* Messages are inserted before this sentinel by the imperative renderer */}
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
                style={{
                    height: stickyHeight,
                    ...(outputBackground ? { background: outputBackground } : {}),
                }}
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

            {contextMenu && (
                <OutputContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    showTimestamps={showTimestamps}
                    onToggleTimestamps={() => patchUI({ showTimestamps: !showTimestamps })}
                    onClose={closeContextMenu}
                />
            )}
        </div>
    );
}
