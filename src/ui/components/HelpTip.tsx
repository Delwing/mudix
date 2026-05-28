import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface HelpTipProps {
    label?: string;
    children: ReactNode;
}

interface Position {
    top: number;
    left: number;
}

export function HelpTip({ label = 'Help', children }: HelpTipProps) {
    const [hover, setHover] = useState(false);
    const [sticky, setSticky] = useState(false);
    const [pos, setPos] = useState<Position | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const closeTimerRef = useRef<number | null>(null);

    const open = hover || sticky;

    // Small delay on close so the user can bridge the gap between the icon
    // and the popover without it vanishing.
    const scheduleClose = () => {
        if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = window.setTimeout(() => setHover(false), 80);
    };
    const cancelClose = () => {
        if (closeTimerRef.current != null) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setHover(true);
    };

    useEffect(() => () => {
        if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    }, []);

    // Position the popover under the icon, centered, but nudge it left
    // when the bubble would otherwise spill past the viewport edge.
    useLayoutEffect(() => {
        if (!open) return;
        const updatePosition = () => {
            const btn = buttonRef.current;
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            const popoverWidth = popoverRef.current?.offsetWidth ?? 280;
            const margin = 8;
            let left = rect.left + rect.width / 2;
            const halfWidth = popoverWidth / 2;
            if (left + halfWidth > window.innerWidth - margin) {
                left = window.innerWidth - margin - halfWidth;
            }
            if (left - halfWidth < margin) {
                left = margin + halfWidth;
            }
            setPos({ top: rect.bottom + 6, left });
        };
        updatePosition();
        const onScrollOrResize = () => updatePosition();
        window.addEventListener('scroll', onScrollOrResize, true);
        window.addEventListener('resize', onScrollOrResize);
        return () => {
            window.removeEventListener('scroll', onScrollOrResize, true);
            window.removeEventListener('resize', onScrollOrResize);
        };
    }, [open]);

    useEffect(() => {
        if (!sticky) return;
        const onDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (buttonRef.current?.contains(target)) return;
            if (popoverRef.current?.contains(target)) return;
            setSticky(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSticky(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [sticky]);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                className="help-tip"
                aria-label={label}
                aria-expanded={open}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
                onFocus={cancelClose}
                onBlur={scheduleClose}
                onClick={() => setSticky(s => !s)}
            >
                ?
            </button>
            {open && createPortal(
                <div
                    ref={popoverRef}
                    role="tooltip"
                    className={`help-tip-popover${sticky ? ' help-tip-popover--sticky' : ''}`}
                    style={pos ? { top: pos.top, left: pos.left, visibility: 'visible' } : { visibility: 'hidden' }}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                >
                    {children}
                </div>,
                document.body,
            )}
        </>
    );
}
