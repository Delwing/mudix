import { useEffect, useRef, useCallback, useState } from 'react';
import type { MudSession } from '../mud/MudSession';
import { setupOutputRenderer, type OutputRendererControls, type CursorOps } from '../ui/output/OutputRenderer';

export const DEFAULT_STICKY_LINES = 50;

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
        stickyLines = DEFAULT_STICKY_LINES,
        maxElements = 1000,
        splitViewThreshold = 1,
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
            onCursorReady: (ops) => {
                session.windowCursors.set('main', ops);
            },
        });
        rendererRef.current = controls;
        controls.setTimestampVisibility(showTimestamps);

        session.markOutputReady();

        return () => {
            rendererRef.current = null;
            session.markOutputGone();
            session.windowCursors.delete('main');
            outputEl.removeEventListener('scroll', handleScroll);
            outputEl.removeEventListener('wheel', handleWheel);
            controls.teardown();
        };
    }, [session, handleScroll, handleWheel, stickyLines, maxElements]);

    useEffect(() => {
        rendererRef.current?.setTimestampVisibility(showTimestamps);
    }, [showTimestamps]);

    return { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom };
}

export interface UseTextPanelOptions extends UseOutputOptions {
    onCursorReady?: (ops: CursorOps) => void;
}

export interface UseTextPanelResult {
    outputRef: React.RefObject<HTMLDivElement>;
    sentinelRef: React.RefObject<HTMLDivElement>;
    stickyAreaRef: React.RefObject<HTMLDivElement>;
    isSplitView: boolean;
    scrollToBottom: () => void;
    controls: OutputRendererControls | null;
}

export function useTextPanelOutput({
    stickyLines = DEFAULT_STICKY_LINES,
    maxElements = 1000,
    splitViewThreshold = 1,
    onCursorReady,
}: UseTextPanelOptions = {}): UseTextPanelResult {
    const outputRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const stickyAreaRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<OutputRendererControls | null>(null);
    const [controls, setControls] = useState<OutputRendererControls | null>(null);
    const onCursorReadyRef = useRef(onCursorReady);

    const isSplitViewRef = useRef(false);
    const suppressUntilRef = useRef(0);

    const [isSplitView, setIsSplitView] = useState(false);

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

        const c = setupOutputRenderer(null, {
            outputWrapper: outputEl,
            sentinel: sentinelEl,
            stickyArea: stickyAreaEl,
            isSplitView: () => isSplitViewRef.current,
            stickyLines,
            maxElements,
            suppressSplitView: (ms) => {
                suppressUntilRef.current = Date.now() + ms;
            },
            onCursorReady: onCursorReadyRef.current,
        });
        rendererRef.current = c;
        setControls(c);

        return () => {
            rendererRef.current = null;
            setControls(null);
            outputEl.removeEventListener('scroll', handleScroll);
            outputEl.removeEventListener('wheel', handleWheel);
            c.teardown();
        };
    }, [handleScroll, handleWheel, stickyLines, maxElements]);

    return { outputRef, sentinelRef, stickyAreaRef, isSplitView, scrollToBottom, controls };
}
