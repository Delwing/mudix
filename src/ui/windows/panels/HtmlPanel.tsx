import { useEffect, useRef } from 'react';
import type React from 'react';
import type { WindowManager } from '../WindowManager';
import type { GaugeManager } from '../../gauges/GaugeManager';
import type { LabelManager } from '../../labels/LabelManager';
import { GaugeOverlay } from '../../gauges/GaugeOverlay';
import { LabelOverlay } from '../../labels/LabelOverlay';

interface HtmlPanelProps {
    id: string;
    manager: WindowManager;
    gauges?: GaugeManager;
    labels?: LabelManager;
}

export function HtmlPanel({ id, manager, gauges, labels }: HtmlPanelProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        manager.register(id, ref.current, 'html');
        return () => manager.unregister(id);
    }, [manager, id]);

    return (
        <div style={WRAPPER_STYLE}>
            <div ref={ref} className="window-html-panel" style={INNER_STYLE} />
            {labels && <LabelOverlay manager={labels} parent={id} />}
            {gauges && <GaugeOverlay manager={gauges} parent={id} />}
        </div>
    );
}

const WRAPPER_STYLE: React.CSSProperties = { position: 'relative', height: '100%', width: '100%' };
const INNER_STYLE: React.CSSProperties = { height: '100%', width: '100%', overflow: 'auto' };
