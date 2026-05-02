import { useEffect, useRef, useCallback, useState } from 'react';
import type { MudSession } from '../mud/MudSession';
import { setupOutputRenderer, type OutputRendererControls } from '../ui/output/OutputRenderer';

export interface UseOutputOptions {
    stickyLines?: number;
    maxElements?: number;
    splitViewThreshold?: number;
    showTimestamps?: boolean;
}

export interface UseOutputResult {
    outputRef: React.RefObject<HTMLDivElement>;
    sentinelRef: React.RefObject<HTMLDivElement>;
    stickyAreaRef: React.RefObject<HTMLDivElement>;
    isSplitView: boolean;
    scrollToBottom: () => void;
}

export function useOutputArea(
    session: MudSession,
    {
        stickyLines = 5,
        maxElements = 1000,
        splitViewThreshold = 60,
        showTimestamps = false,
    }: UseOutputOptions = {},
): UseOutputResult {
    const outputRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const stickyAreaRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<OutputRendererControls | null>(null);

    const isSplitViewRef = useRef(false);
    const suppressUntilRef = useRef(0);

    const [isSplitView, setIsSplitView] = useState(false);

    const scrollToBottom = useCallback(() => {
        const el = outputRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        isSplitViewRef.current = false;
        setIsSplitView(false);
    }, []);

    const handleScroll = useCallback(() => {
        const el = outputRef.current;
        if (!el || Date.now() < suppressUntilRef.current) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const next = distFromBottom > splitViewThreshold;
        if (next !== isSplitViewRef.current) {
            isSplitViewRef.current = next;
            setIsSplitView(next);
        }
    }, [splitViewThreshold]);

    useEffect(() => {
        const outputEl = outputRef.current;
        const sentinelEl = sentinelRef.current;
        const stickyAreaEl = stickyAreaRef.current;
        if (!outputEl || !sentinelEl || !stickyAreaEl) return;

        outputEl.addEventListener('scroll', handleScroll, { passive: true });

        const controls = setupOutputRenderer(session.events, {
            outputWrapper: outputEl,
            sentinel: sentinelEl,
            stickyArea: stickyAreaEl,
            isSplitView: () => isSplitViewRef.current,
            stickyLines,
            maxElements,
            suppressSplitView: (ms) => {
                suppressUntilRef.current = Date.now() + ms;
            },
        });
        rendererRef.current = controls;
        controls.setTimestampVisibility(showTimestamps);

        session.markOutputReady();

        return () => {
            rendererRef.current = null;
            session.markOutputGone();
            outputEl.removeEventListener('scroll', handleScroll);
            controls.teardown();
        };
    }, [session, handleScroll, stickyLines, maxElements]);

    useEffect(() => {
        rendererRef.current?.setTimestampVisibility(showTimestamps);
    }, [showTimestamps]);

    return { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom };
}
