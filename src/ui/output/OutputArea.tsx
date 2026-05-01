import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import { useOutputArea } from '../../hooks/useOutput';

interface OutputAreaProps {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

export function OutputArea({ session, stickyLines = 5, commandInputRef }: OutputAreaProps) {
    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom } =
        useOutputArea(session, { stickyLines });

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!commandInputRef) return;
        const target = e.target as Element;
        if (!target.closest('a, button, input, select, textarea')) {
            commandInputRef.current?.focus();
        }
    };

    return (
        <div className="output-container" onClick={handleClick}>
            <div className="output-wrapper" ref={outputRef}>
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
        </div>
    );
}
