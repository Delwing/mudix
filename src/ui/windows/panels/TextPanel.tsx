import { useEffect, useRef } from 'react';
import type React from 'react';
import type { WindowManager } from '../WindowManager';
import type { LabelManager } from '../../labels/LabelManager';
import { useStickyOutput } from '../../../hooks/useOutput';
import { StickyOutputPanel } from '../../output/StickyOutputPanel';
import { LabelOverlay } from '../../labels/LabelOverlay';
import { backgroundImageStyle } from '../../output/backgroundImageStyle';

interface TextPanelProps {
    id: string;
    manager: WindowManager;
    labels?: LabelManager;
    fontSize?: number;
    fontFamily?: string;
    wrapAt?: number;
    backgroundColor?: { r: number; g: number; b: number; a: number };
    backgroundImage?: { url: string; mode: number };
}

export function TextPanel({ id, manager, labels, fontSize, fontFamily, wrapAt, backgroundColor, backgroundImage }: TextPanelProps) {
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

    // Wrap StickyOutputPanel + LabelOverlay in a positioned box so the overlay
    // positions against the same rectangle reported by getUserWindowSize. Without
    // this, label-overlay's `inset: 0` would fall back to a dockview ancestor
    // and labels sized to getUserWindowSize() wouldn't fill the user window.
    return (
        <div ref={viewportRef} data-mudix-window={id} style={VIEWPORT_STYLE}>
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
            {labels && <LabelOverlay manager={labels} parent={id} />}
        </div>
    );
}

const VIEWPORT_STYLE: React.CSSProperties = { position: 'relative', height: '100%', width: '100%' };
