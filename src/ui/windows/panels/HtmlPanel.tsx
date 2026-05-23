import { useEffect, useRef } from 'react';
import type React from 'react';
import type { WindowManager } from '../WindowManager';
import type { LabelManager } from '../../labels/LabelManager';
import { LabelOverlay } from '../../labels/LabelOverlay';
import { backgroundImageStyle } from '../../output/backgroundImageStyle';

interface HtmlPanelProps {
    id: string;
    manager: WindowManager;
    labels?: LabelManager;
    backgroundColor?: { r: number; g: number; b: number; a: number };
    backgroundImage?: { url: string; mode: number };
}

export function HtmlPanel({ id, manager, labels, backgroundColor, backgroundImage }: HtmlPanelProps) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current || !viewportRef.current) return;
        manager.register(id, ref.current, 'html');
        manager.registerViewport(id, viewportRef.current);
        return () => manager.unregister(id);
    }, [manager, id]);

    const bgImage = backgroundImageStyle(backgroundImage);
    const innerStyle: React.CSSProperties = (backgroundColor || bgImage)
        ? {
            ...INNER_STYLE,
            ...(backgroundColor ? { background: `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a / 255})` } : {}),
            ...(bgImage ?? {}),
        }
        : INNER_STYLE;

    return (
        <div ref={viewportRef} data-mudix-window={id} style={WRAPPER_STYLE}>
            <div ref={ref} className="window-html-panel" style={innerStyle} />
            {labels && <LabelOverlay manager={labels} parent={id} />}
        </div>
    );
}

const WRAPPER_STYLE: React.CSSProperties = { position: 'relative', height: '100%', width: '100%' };
const INNER_STYLE: React.CSSProperties = { height: '100%', width: '100%', overflow: 'auto' };
