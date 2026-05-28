import { useEffect, useRef, useCallback, useState } from 'react';
import { setupOutputRenderer, type OutputRendererControls, type MessageSource } from '../ui/output/OutputRenderer';

export const DEFAULT_STICKY_LINES = 50;

export interface UseStickyOutputOptions {
    stickyLines?: number;
    maxElements?: number;
    splitViewThreshold?: number;
    showTimestamps?: boolean;
}

export interface UseStickyOutputResult {
    outputRef: React.RefObject<HTMLDivElement | null>;
    sentinelRef: React.RefObject<HTMLDivElement | null>;
    stickyAreaRef: React.RefObject<HTMLDivElement | null>;
    isSplitView: boolean;
    scrollToBottom: () => void;
    controls: OutputRendererControls | null;
}

export function useStickyOutput(
    source: MessageSource | null,
    {
        stickyLines = DEFAULT_STICKY_LINES,
        maxElements = 1000,
        splitViewThreshold = 1,
        showTimestamps = false,
    }: UseStickyOutputOptions = {},
): UseStickyOutputResult {
    const outputRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const stickyAreaRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<OutputRendererControls | null>(null);

    const isSplitViewRef = useRef(false);
    const suppressUntilRef = useRef(0);

    const [isSplitView, setIsSplitView] = useState(false);
    const [controls, setControls] = useState<OutputRendererControls | null>(null);

    const scrollToBottom = useCallback(() => {
        const el = outputRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        isSplitViewRef.current = false;
        setIsSplitView(false);
        rendererRef.current?.clearStickyArea();
    }, []);

    const handleScroll = useCallback(() => {
        const el = outputRef.current;
        if (!el || Date.now() < suppressUntilRef.current) return;
        const distFromBottom = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
        const next = distFromBottom > splitViewThreshold;
        if (next !== isSplitViewRef.current) {
            isSplitViewRef.current = next;
            setIsSplitView(next);
            if (next) {
                rendererRef.current?.populateStickyArea();
            } else {
                rendererRef.current?.clearStickyArea();
            }
        }
    }, [splitViewThreshold]);

    // Fires before the browser scrolls — lets us show the sticky with zero visual delay.
    const handleWheel = useCallback((e: WheelEvent) => {
        const el = outputRef.current;
        if (!el || isSplitViewRef.current || Date.now() < suppressUntilRef.current) return;
        if (e.deltaY < 0) {
            const distFromBottom = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
            if (distFromBottom <= splitViewThreshold) {
                isSplitViewRef.current = true;
                setIsSplitView(true);
                rendererRef.current?.populateStickyArea();
            }
        }
    }, [splitViewThreshold]);

    useEffect(() => {
        const outputEl = outputRef.current;
        const sentinelEl = sentinelRef.current;
        const stickyAreaEl = stickyAreaRef.current;
        if (!outputEl || !sentinelEl || !stickyAreaEl) return;

        outputEl.addEventListener('scroll', handleScroll, { passive: true });
        outputEl.addEventListener('wheel', handleWheel, { passive: true });

        const c = setupOutputRenderer(source, {
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
        c.setTimestampVisibility(showTimestamps);
        rendererRef.current = c;
        setControls(c);

        return () => {
            rendererRef.current = null;
            setControls(null);
            outputEl.removeEventListener('scroll', handleScroll);
            outputEl.removeEventListener('wheel', handleWheel);
            c.teardown();
        };
    }, [source, handleScroll, handleWheel, stickyLines, maxElements]);

    useEffect(() => {
        rendererRef.current?.setTimestampVisibility(showTimestamps);
    }, [showTimestamps]);

    return { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom, controls };
}
