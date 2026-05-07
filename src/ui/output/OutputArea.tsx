import { useEffect, useRef } from 'react';
import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import { useStickyOutput, DEFAULT_STICKY_LINES } from '../../hooks/useOutput';
import { useAppStore } from '../../storage';
import { StickyOutputPanel } from './StickyOutputPanel';
import { LabelOverlay } from '../labels/LabelOverlay';

interface OutputAreaProps {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

export function OutputArea({ session, stickyLines = DEFAULT_STICKY_LINES, commandInputRef }: OutputAreaProps) {
    const outputBackgroundString = useAppStore(s => s.ui.outputBackground);
    const outputBackgroundColor = useAppStore(s => s.ui.outputBackgroundColor);
    const outputBackground = outputBackgroundColor
        ? `rgba(${outputBackgroundColor.r}, ${outputBackgroundColor.g}, ${outputBackgroundColor.b}, ${outputBackgroundColor.a / 255})`
        : outputBackgroundString;
    const showTimestamps = useAppStore(s => s.ui.showTimestamps);
    const fontSize = useAppStore(s => s.ui.fontSize);
    const wrapAt = useAppStore(s => s.ui.outputWrapAt);
    const borders = useAppStore(s => s.ui.outputBorders);
    const borderColor = useAppStore(s => s.ui.outputBorderColor);
    const patchUI = useAppStore(s => s.patchUI);

    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom } =
        useStickyOutput(session.events, { stickyLines, showTimestamps });
    const viewportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        session.markOutputReady();
        return () => session.markOutputGone();
    }, [session]);

    useEffect(() => {
        session.windows.registerMainOutput(outputRef.current);
        session.windows.registerMainViewport(viewportRef.current);
        return () => {
            session.windows.registerMainOutput(null);
            session.windows.registerMainViewport(null);
        };
    }, [session, outputRef]);

    // Mudlet setBorderTop/Bottom/Left/Right insets the console; labels still
    // own the full main-viewport so they can be placed in the carved area.
    const contentStyle: React.CSSProperties = {
        paddingTop: borders?.top || undefined,
        paddingRight: borders?.right || undefined,
        paddingBottom: borders?.bottom || undefined,
        paddingLeft: borders?.left || undefined,
        background: borderColor
            ? `rgba(${borderColor.r}, ${borderColor.g}, ${borderColor.b}, ${borderColor.a / 255})`
            : undefined,
    };

    return (
        <>
            <div className="output-area-content" ref={viewportRef} style={contentStyle}>
                <StickyOutputPanel
                    outputRef={outputRef}
                    sentinelRef={sentinelRef}
                    stickyAreaRef={stickyAreaRef}
                    isSplitView={isSplitView}
                    scrollToBottom={scrollToBottom}
                    background={outputBackground}
                    showTimestamps={showTimestamps}
                    onToggleTimestamps={() => patchUI({ showTimestamps: !showTimestamps })}
                    commandInputRef={commandInputRef}
                    fontSize={fontSize}
                    wrapAt={wrapAt}
                />
            </div>
            <LabelOverlay manager={session.labels} parent="main" />
        </>
    );
}
