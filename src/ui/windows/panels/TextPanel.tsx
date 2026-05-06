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
}

export function TextPanel({ id, manager, labels }: TextPanelProps) {
    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom, controls } =
        useStickyOutput(null, { stickyLines: 50 });

    useEffect(() => {
        if (!controls || !outputRef.current) return;
        manager.registerTextPanel(id, controls, outputRef.current);
        return () => manager.unregister(id);
    }, [manager, id, controls]);

    return (
        <>
            <StickyOutputPanel
                outputRef={outputRef}
                sentinelRef={sentinelRef}
                stickyAreaRef={stickyAreaRef}
                isSplitView={isSplitView}
                scrollToBottom={scrollToBottom}
                className="window-text-panel"
            />
            {labels && <LabelOverlay manager={labels} parent={id} />}
        </>
    );
}
