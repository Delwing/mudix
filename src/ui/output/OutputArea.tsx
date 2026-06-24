import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import type { MouseEventEntry } from '../MouseEventRegistry';
import { useStickyOutput, DEFAULT_STICKY_LINES } from '../../hooks/useOutput';
import { useAppStore, useProfileField, useConnectionId } from '../../storage';
import { StickyOutputPanel } from './StickyOutputPanel';
import { ScreenReaderLog } from './ScreenReaderLog';
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

    // Mudlet addMouseEvent: custom entries in the output area's right-click menu.
    const [mouseMenu, setMouseMenu] = useState<{ x: number; y: number; items: MouseEventEntry[] } | null>(null);
    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        const items = session.mouseEvents.list();
        if (items.length === 0) return;
        e.preventDefault();
        setMouseMenu({ x: e.clientX, y: e.clientY, items });
    };

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
            <div className="output-area-content" ref={viewportRef} style={contentStyle} onContextMenu={handleContextMenu}>
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
                    commandInputRef={commandInputRef}
                    fontSize={fontSize}
                    wrapAt={wrapAt}
                    wrapIndent={wrapIndent}
                    wrapHangingIndent={wrapHangingIndent}
                />
            </div>
            <ScreenReaderLog session={session} />
            <LabelOverlay manager={session.labels} parent="main" />
            <CommandLineOverlay manager={session.cmdLines} parent="main" />
            <ScrollBoxOverlay manager={session.scrollBoxes} labels={session.labels} cmdLines={session.cmdLines} parent="main" />
            {mouseMenu && (
                <>
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                        onMouseDown={() => setMouseMenu(null)}
                        onContextMenu={(e) => { e.preventDefault(); setMouseMenu(null); }}
                    />
                    <div
                        className="map-context-menu"
                        style={{ position: 'fixed', left: mouseMenu.x, top: mouseMenu.y, zIndex: 9999 }}
                        onContextMenu={(e) => e.preventDefault()}
                    >
                        {mouseMenu.items.map(item => (
                            <div
                                key={item.uniqueName}
                                className="map-context-menu-item"
                                title={item.tooltip || undefined}
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    session.mouseEvents.dispatch(item.uniqueName);
                                    setMouseMenu(null);
                                }}
                            >
                                <span className="map-context-menu-label">{item.displayName}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}
