import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { LabelManager, LabelMouseEvent, LabelState, LabelWheelEvent } from './LabelManager';
import { cssTextToStyle } from './qtCss';
import './LabelOverlay.css';

// Mudlet uses Qt::MouseButton flags (1=left, 2=right, 4=middle); DOM `button`
// is 0/1/2 for left/middle/right. Translate so scripts reading `event.button`
// see Mudlet's encoding.
const BUTTON_DOM_TO_MUDLET: Record<number, number> = { 0: 1, 1: 4, 2: 2 };

function buildMouseEvent(e: React.MouseEvent<HTMLDivElement>): LabelMouseEvent {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
        button:  BUTTON_DOM_TO_MUDLET[e.button] ?? 0,
        x:       Math.round(e.clientX - rect.left),
        y:       Math.round(e.clientY - rect.top),
        globalX: Math.round(e.clientX),
        globalY: Math.round(e.clientY),
        alt:     e.altKey,
        ctrl:    e.ctrlKey,
        shift:   e.shiftKey,
        meta:    e.metaKey,
    };
}

function buildWheelEvent(e: React.WheelEvent<HTMLDivElement>): LabelWheelEvent {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
        button:  0,
        x:       Math.round(e.clientX - rect.left),
        y:       Math.round(e.clientY - rect.top),
        globalX: Math.round(e.clientX),
        globalY: Math.round(e.clientY),
        alt:     e.altKey,
        ctrl:    e.ctrlKey,
        shift:   e.shiftKey,
        meta:    e.metaKey,
        angleDelta: { x: -e.deltaX, y: -e.deltaY },
    };
}

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
    // Latest-callback ref so re-renders during a hover/drag don't lose pointer
    // state; the Mudlet API replaces callbacks live and we want the next event
    // to land on the new fn even if React hasn't re-mounted us yet.
    const ref = useRef(l);
    ref.current = l;
    if (!l.visible) return null;

    const style: React.CSSProperties = {
        left: l.x, top: l.y,
        width: l.width, height: l.height,
        pointerEvents: l.clickThrough ? 'none' : 'auto',
        cursor: l.cursor ?? (l.onClick ? 'pointer' : undefined),
        zIndex: l.zIndex,
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
    // Stylesheet wins over computed background when both are set, matching
    // Mudlet (where setLabelStyleSheet replaces the QLabel's full QSS block).
    if (l.styleSheet) Object.assign(style, cssTextToStyle(l.styleSheet));

    return (
        <div
            className="label"
            style={style}
            title={l.tooltip}
            onClick={l.onClick && (e => ref.current.onClick?.(buildMouseEvent(e)))}
            onMouseUp={l.onMouseUp && (e => ref.current.onMouseUp?.(buildMouseEvent(e)))}
            onDoubleClick={l.onDoubleClick && (e => ref.current.onDoubleClick?.(buildMouseEvent(e)))}
            onMouseMove={l.onMouseMove && (e => ref.current.onMouseMove?.(buildMouseEvent(e)))}
            onMouseEnter={l.onMouseEnter && (e => ref.current.onMouseEnter?.(buildMouseEvent(e)))}
            onMouseLeave={l.onMouseLeave && (e => ref.current.onMouseLeave?.(buildMouseEvent(e)))}
            onWheel={l.onWheel && (e => ref.current.onWheel?.(buildWheelEvent(e)))}
            dangerouslySetInnerHTML={{ __html: l.html }}
        />
    );
}
