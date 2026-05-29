import { useEffect, useRef } from 'react';
import type React from 'react';
import type { WindowManager } from '../WindowManager';
import type { LabelManager } from '../../labels/LabelManager';
import type { CommandLineManager } from '../../cmdline/CommandLineManager';
import type { ScrollBoxManager } from '../../scrollbox/ScrollBoxManager';
import { useStickyOutput } from '../../../hooks/useOutput';
import { StickyOutputPanel } from '../../output/StickyOutputPanel';
import { LabelOverlay } from '../../labels/LabelOverlay';
import { CommandLineOverlay } from '../../cmdline/CommandLineOverlay';
import { ScrollBoxOverlay } from '../../scrollbox/ScrollBoxOverlay';
import { backgroundImageStyle } from '../../output/backgroundImageStyle';
import { WindowCmdLine } from './WindowCmdLine';

interface TextPanelProps {
    id: string;
    manager: WindowManager;
    labels?: LabelManager;
    cmdLines?: CommandLineManager;
    scrollBoxes?: ScrollBoxManager;
    fontSize?: number;
    fontFamily?: string;
    wrapAt?: number;
    backgroundColor?: { r: number; g: number; b: number; a: number };
    backgroundImage?: { url: string; mode: number };
    cmdLineEnabled?: boolean;
    cmdLineStyleSheet?: string;
    cmdLineValue?: string;
    cmdLineValueSeq?: number;
}

export function TextPanel({ id, manager, labels, cmdLines, scrollBoxes, fontSize, fontFamily, wrapAt, backgroundColor, backgroundImage, cmdLineEnabled, cmdLineStyleSheet, cmdLineValue, cmdLineValueSeq }: TextPanelProps) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom, controls } =
        useStickyOutput(null, { stickyLines: 50 });

    useEffect(() => {
        if (!controls || !outputRef.current || !viewportRef.current) return;
        manager.registerTextPanel(id, controls, outputRef.current);
        manager.registerViewport(id, viewportRef.current);
        return () => manager.unregister(id);
    }, [manager, id, controls]);

    const background = backgroundColor
        ? `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a / 255})`
        : undefined;
    const backgroundExtra = backgroundImageStyle(backgroundImage) ?? undefined;

    // The viewport div carries the data-mudix-window attribute and is the
    // target of setUserWindowStyleSheet (padding, background, etc). LabelOverlay
    // must be a direct child so its `inset: 0` spans the padding box — labels
    // positioned at (0,0) sit at the userwindow's visible top-left, not inside
    // the padded content area. The output (and the optional command line) live
    // in a separate child stack so the command-line input docks below the
    // output without disturbing label positioning.
    const stickyPanel = (
        <StickyOutputPanel
            outputRef={outputRef}
            sentinelRef={sentinelRef}
            stickyAreaRef={stickyAreaRef}
            isSplitView={isSplitView}
            scrollToBottom={scrollToBottom}
            className="window-text-panel"
            fontSize={fontSize}
            fontFamily={fontFamily}
            wrapAt={wrapAt}
            background={background}
            backgroundExtra={backgroundExtra}
        />
    );

    return (
        <div ref={viewportRef} data-mudix-window={id} style={VIEWPORT_STYLE}>
            {cmdLineEnabled ? (
                <div style={STACK_STYLE}>
                    <div style={OUTPUT_FILL_STYLE}>{stickyPanel}</div>
                    <WindowCmdLine
                        id={id}
                        manager={manager}
                        styleSheet={cmdLineStyleSheet}
                        seedValue={cmdLineValue}
                        seedSeq={cmdLineValueSeq}
                    />
                </div>
            ) : (
                stickyPanel
            )}
            {labels && <LabelOverlay manager={labels} parent={id} />}
            {cmdLines && <CommandLineOverlay manager={cmdLines} parent={id} />}
            {scrollBoxes && labels && cmdLines && (
                <ScrollBoxOverlay manager={scrollBoxes} labels={labels} cmdLines={cmdLines} parent={id} />
            )}
        </div>
    );
}

const VIEWPORT_STYLE: React.CSSProperties = { position: 'relative', height: '100%', width: '100%' };
const STACK_STYLE: React.CSSProperties   = { position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column' };
const OUTPUT_FILL_STYLE: React.CSSProperties = { position: 'relative', flex: '1 1 auto', minHeight: 0 };
