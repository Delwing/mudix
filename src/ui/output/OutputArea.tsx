import type { MudSession } from '../../mud/MudSession';
import { useOutput } from '../../hooks/useOutput';

interface OutputAreaProps {
    session: MudSession;
    stickyLines?: number;
}

export function OutputArea({ session, stickyLines = 5 }: OutputAreaProps) {
    const { outputRef, splitBottomRef, stickyAreaRef, isSplitView, scrollToBottom } =
        useOutput(session, { stickyLines });

    return (
        <div className="output-container">
            <div className="output-wrapper" ref={outputRef}>
                {/* Messages are inserted before this sentinel by the imperative renderer */}
                <div ref={splitBottomRef} style={{ height: 0 }} />
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
