import { useEffect, useState } from 'react';
import type React from 'react';
import type { LabelManager, LabelState } from './LabelManager';
import './LabelOverlay.css';

interface LabelOverlayProps {
    manager: LabelManager;
    parent: string;
}

export function LabelOverlay({ manager, parent }: LabelOverlayProps) {
    const [labels, setLabels] = useState<LabelState[]>(() => manager.list(parent));
    useEffect(() => manager.subscribe(parent, setLabels), [manager, parent]);
    if (labels.length === 0) return null;
    return (
        <div className="label-overlay">
            {labels.map(l => <Label key={l.name} l={l} />)}
        </div>
    );
}

function Label({ l }: { l: LabelState }) {
    if (!l.visible) return null;

    const style: React.CSSProperties = {
        left: l.x, top: l.y,
        width: l.width, height: l.height,
        pointerEvents: l.clickThrough ? 'none' : 'auto',
        cursor: l.onClick ? 'pointer' : undefined,
    };
    if (l.fillBackground) {
        const bg = l.backgroundColor;
        // Mudlet's createLabel with fillBackground=true paints the parent widget's
        // base color until setBackgroundColor() runs. White is a reasonable
        // approximation that matches what the docs describe ("display the
        // background color").
        style.background = bg
            ? `rgba(${bg.r},${bg.g},${bg.b},${bg.a / 255})`
            : '#fff';
    }

    return (
        <div
            className="label"
            style={style}
            onClick={l.onClick}
            dangerouslySetInnerHTML={{ __html: l.html }}
        />
    );
}
