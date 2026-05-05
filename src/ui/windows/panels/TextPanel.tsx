import { useEffect } from 'react';
import type { WindowManager } from '../WindowManager';
import { useStickyOutput } from '../../../hooks/useOutput';
import { StickyOutputPanel } from '../../output/StickyOutputPanel';

export function TextPanel({ id, manager }: { id: string; manager: WindowManager }) {
    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom, controls } =
        useStickyOutput(null, { stickyLines: 50 });

    useEffect(() => {
        if (!controls || !outputRef.current) return;
        manager.registerTextPanel(id, controls, outputRef.current);
        return () => manager.unregister(id);
    }, [manager, id, controls]);

    return (
        <StickyOutputPanel
            outputRef={outputRef}
            sentinelRef={sentinelRef}
            stickyAreaRef={stickyAreaRef}
            isSplitView={isSplitView}
            scrollToBottom={scrollToBottom}
            className="window-text-panel"
        />
    );
}
