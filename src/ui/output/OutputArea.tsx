import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import { useStickyOutput, DEFAULT_STICKY_LINES } from '../../hooks/useOutput';
import { useAppStore, useProfileField, useConnectionId } from '../../storage';
import { StickyOutputPanel } from './StickyOutputPanel';
import type { OutputMenuExtraItem } from './OutputContextMenu';
import { ScreenReaderLog } from './ScreenReaderLog';
import { CaretReviewPanel } from './CaretReviewPanel';
import { LabelOverlay } from '../labels/LabelOverlay';
import { CommandLineOverlay } from '../cmdline/CommandLineOverlay';
import { ScrollBoxOverlay } from '../scrollbox/ScrollBoxOverlay';
import { backgroundImageStyle } from './backgroundImageStyle';

interface OutputAreaProps {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function OutputArea({ session, stickyLines = DEFAULT_STICKY_LINES, commandInputRef }: OutputAreaProps) {
    const connectionId = useConnectionId();
    const outputBackgroundString = useProfileField('outputBackground');
    const outputBackgroundColor = useProfileField('outputBackgroundColor');
    const outputBackgroundImage = useProfileField('outputBackgroundImage');
    const outputBackground = outputBackgroundColor
        ? `rgba(${outputBackgroundColor.r}, ${outputBackgroundColor.g}, ${outputBackgroundColor.b}, ${outputBackgroundColor.a / 255})`
        : outputBackgroundString;
    const outputBackgroundExtra = backgroundImageStyle(outputBackgroundImage) ?? undefined;
    const outputForeground = useProfileField('outputForeground');
    const showTimestamps = useProfileField('showTimestamps');
    const fontSize = useProfileField('fontSize');
    const wrapAt = useProfileField('outputWrapAt');
    const wrapIndent = useProfileField('outputWrapIndent');
    const wrapHangingIndent = useProfileField('outputWrapHangingIndent');
    const borders = useProfileField('outputBorders');
    const borderColor = useProfileField('outputBorderColor');
    const patchConnectionProfile = useAppStore(s => s.patchConnectionProfile);

    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom } =
        useStickyOutput(session.events, { stickyLines, showTimestamps });
    const viewportRef = useRef<HTMLDivElement>(null);

    // Mudlet addMouseEvent: custom entries folded into the output right-click
    // menu. Evaluated lazily when the menu opens (the registry can change).
    const getMenuExtraItems = useCallback((): OutputMenuExtraItem[] =>
        session.mouseEvents.list().map(item => ({
            label: item.displayName,
            tooltip: item.tooltip || undefined,
            onClick: () => session.mouseEvents.dispatch(item.uniqueName),
        })), [session]);

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
                    backgroundExtra={outputBackgroundExtra}
                    foreground={outputForeground}
                    showTimestamps={showTimestamps}
                    onToggleTimestamps={() => connectionId && patchConnectionProfile(connectionId, { showTimestamps: !showTimestamps })}
                    getMenuExtraItems={getMenuExtraItems}
                    commandInputRef={commandInputRef}
                    fontSize={fontSize}
                    wrapAt={wrapAt}
                    wrapIndent={wrapIndent}
                    wrapHangingIndent={wrapHangingIndent}
                />
                <CaretReviewPanel session={session} commandInputRef={commandInputRef} />
            </div>
            <ScreenReaderLog session={session} />
            <LabelOverlay manager={session.labels} parent="main" />
            <CommandLineOverlay manager={session.cmdLines} parent="main" />
            <ScrollBoxOverlay manager={session.scrollBoxes} labels={session.labels} cmdLines={session.cmdLines} parent="main" />
        </>
    );
}
