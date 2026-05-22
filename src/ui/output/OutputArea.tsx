import { useEffect, useRef } from 'react';
import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import { useStickyOutput, DEFAULT_STICKY_LINES } from '../../hooks/useOutput';
import { useAppStore, useProfileField, useConnectionId } from '../../storage';
import { StickyOutputPanel } from './StickyOutputPanel';
import { LabelOverlay } from '../labels/LabelOverlay';

interface OutputAreaProps {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

export function OutputArea({ session, stickyLines = DEFAULT_STICKY_LINES, commandInputRef }: OutputAreaProps) {
    const connectionId = useConnectionId();
    const outputBackgroundString = useProfileField('outputBackground');
    const outputBackgroundColor = useProfileField('outputBackgroundColor');
    const outputBackground = outputBackgroundColor
        ? `rgba(${outputBackgroundColor.r}, ${outputBackgroundColor.g}, ${outputBackgroundColor.b}, ${outputBackgroundColor.a / 255})`
        : outputBackgroundString;
    const showTimestamps = useProfileField('showTimestamps');
    const fontSize = useProfileField('fontSize');
    const wrapAt = useProfileField('outputWrapAt');
    const borders = useProfileField('outputBorders');
    const borderColor = useProfileField('outputBorderColor');
    const patchConnectionProfile = useAppStore(s => s.patchConnectionProfile);

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
                    onToggleTimestamps={() => connectionId && patchConnectionProfile(connectionId, { showTimestamps: !showTimestamps })}
                    commandInputRef={commandInputRef}
                    fontSize={fontSize}
                    wrapAt={wrapAt}
                />
            </div>
            <LabelOverlay manager={session.labels} parent="main" />
        </>
    );
}
