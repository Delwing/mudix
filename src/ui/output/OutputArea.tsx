import { useState, useCallback } from 'react';
import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import { useOutputArea } from '../../hooks/useOutput';
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

export function OutputArea({ session, stickyLines = 5, commandInputRef }: OutputAreaProps) {
    const outputBackground = useAppStore(s => s.ui.outputBackground);
    const showTimestamps = useAppStore(s => s.ui.showTimestamps);
    const patchUI = useAppStore(s => s.patchUI);

    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom } =
        useOutputArea(session, { stickyLines, showTimestamps });

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

            <div
                className={`output-sticky${isSplitView ? ' output-sticky--active' : ''}`}
                ref={stickyAreaRef}
            />

            {isSplitView && (
                <button
                    className="scroll-to-bottom"
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
