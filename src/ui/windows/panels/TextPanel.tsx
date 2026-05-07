import { useEffect } from 'react';
import type { WindowManager } from '../WindowManager';
import type { LabelManager } from '../../labels/LabelManager';
import { useStickyOutput } from '../../../hooks/useOutput';
import { StickyOutputPanel } from '../../output/StickyOutputPanel';
import { LabelOverlay } from '../../labels/LabelOverlay';

interface TextPanelProps {
    id: string;
    manager: WindowManager;
    labels?: LabelManager;
    fontSize?: number;
    fontFamily?: string;
    wrapAt?: number;
    backgroundColor?: { r: number; g: number; b: number; a: number };
}

export function TextPanel({ id, manager, labels, fontSize, fontFamily, wrapAt, backgroundColor }: TextPanelProps) {
    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom, controls } =
        useStickyOutput(null, { stickyLines: 50 });

    useEffect(() => {
        if (!controls || !outputRef.current) return;
        manager.registerTextPanel(id, controls, outputRef.current);
        return () => manager.unregister(id);
    }, [manager, id, controls]);

    const background = backgroundColor
        ? `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a / 255})`
        : undefined;

    return (
        <>
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
            />
            {labels && <LabelOverlay manager={labels} parent={id} />}
        </>
    );
}
