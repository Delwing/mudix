import { useEffect } from 'react';
import type React from 'react';
import type { MudSession } from '../../mud/MudSession';
import { useStickyOutput, DEFAULT_STICKY_LINES } from '../../hooks/useOutput';
import { useAppStore } from '../../storage';
import { StickyOutputPanel } from './StickyOutputPanel';
import { GaugeOverlay } from '../gauges/GaugeOverlay';
import { LabelOverlay } from '../labels/LabelOverlay';

interface OutputAreaProps {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

export function OutputArea({ session, stickyLines = DEFAULT_STICKY_LINES, commandInputRef }: OutputAreaProps) {
    const outputBackground = useAppStore(s => s.ui.outputBackground);
    const showTimestamps = useAppStore(s => s.ui.showTimestamps);
    const patchUI = useAppStore(s => s.patchUI);

    const { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom } =
        useStickyOutput(session.events, { stickyLines, showTimestamps });

    useEffect(() => {
        session.markOutputReady();
        return () => session.markOutputGone();
    }, [session]);

    return (
        <>
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
            />
            <LabelOverlay manager={session.labels} parent="main" />
            <GaugeOverlay manager={session.gauges} parent="main" />
        </>
    );
}
