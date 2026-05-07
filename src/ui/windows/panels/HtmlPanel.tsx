import { useEffect, useRef } from 'react';
import type React from 'react';
import type { WindowManager } from '../WindowManager';
import type { LabelManager } from '../../labels/LabelManager';
import { LabelOverlay } from '../../labels/LabelOverlay';

interface HtmlPanelProps {
    id: string;
    manager: WindowManager;
    labels?: LabelManager;
    backgroundColor?: { r: number; g: number; b: number; a: number };
}

export function HtmlPanel({ id, manager, labels, backgroundColor }: HtmlPanelProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        manager.register(id, ref.current, 'html');
        return () => manager.unregister(id);
    }, [manager, id]);

    const innerStyle: React.CSSProperties = backgroundColor
        ? { ...INNER_STYLE, background: `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a / 255})` }
        : INNER_STYLE;

    return (
        <div style={WRAPPER_STYLE}>
            <div ref={ref} className="window-html-panel" style={innerStyle} />
            {labels && <LabelOverlay manager={labels} parent={id} />}
        </div>
    );
}

const WRAPPER_STYLE: React.CSSProperties = { position: 'relative', height: '100%', width: '100%' };
const INNER_STYLE: React.CSSProperties = { height: '100%', width: '100%', overflow: 'auto' };
