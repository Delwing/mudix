import { useEffect, useRef, useCallback, useState } from 'react';
import type { MudSession } from '../mud/MudSession';
import { setupOutputRenderer } from '../ui/output/OutputRenderer';

export interface UseOutputOptions {
    stickyLines?: number;
    maxElements?: number;
    splitViewThreshold?: number;
}

export interface UseOutputResult {
    outputRef: React.RefObject<HTMLDivElement>;
    splitBottomRef: React.RefObject<HTMLDivElement>;
    stickyAreaRef: React.RefObject<HTMLDivElement>;
    isSplitView: boolean;
    scrollToBottom: () => void;
}

export function useOutput(
    session: MudSession,
    {
        stickyLines = 5,
        maxElements = 1000,
        splitViewThreshold = 60,
    }: UseOutputOptions = {},
): UseOutputResult {
    const outputRef = useRef<HTMLDivElement>(null);
    const splitBottomRef = useRef<HTMLDivElement>(null);
    const stickyAreaRef = useRef<HTMLDivElement>(null);

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
        const splitBottomEl = splitBottomRef.current;
        const stickyAreaEl = stickyAreaRef.current;
        if (!outputEl || !splitBottomEl || !stickyAreaEl) return;

        outputEl.addEventListener('scroll', handleScroll, { passive: true });

        const teardown = setupOutputRenderer(session.events, {
            outputWrapper: outputEl,
            splitBottom: splitBottomEl,
            stickyArea: stickyAreaEl,
            isSplitView: () => isSplitViewRef.current,
            stickyLines,
            maxElements,
            suppressSplitView: (ms) => {
                suppressUntilRef.current = Date.now() + ms;
            },
        });

        return () => {
            outputEl.removeEventListener('scroll', handleScroll);
            teardown();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, handleScroll]);

    return { outputRef, splitBottomRef, stickyAreaRef, isSplitView, scrollToBottom };
}
