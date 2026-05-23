import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { LabelManager, LabelMouseEvent, LabelState, LabelWheelEvent } from './LabelManager';
import { cssTextToParts, qtDeclarationsToCss, cssEscape } from './qtCss';
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

    // Manage a single <style> element per label for Qt pseudo-state rules
    // (`QLabel:hover`, etc.). Inline styles can't express these, and `<style
    // scoped>` was deprecated — so inject into <head>, scoped via the label's
    // data-attribute selector.
    useEffect(() => {
        if (!l.styleSheet) return;
        const parts = cssTextToParts(l.styleSheet);
        if (parts.scoped.length === 0) return;
        const id = `mudix-label-stylesheet--${l.name}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
        }
        const sel = `[data-mudix-label="${cssEscape(l.name)}"]`;
        el.textContent = parts.scoped
            .map(r => `${sel}${r.pseudo} { ${qtDeclarationsToCss(r.declarations)} }`)
            .join('\n');
        return () => { document.getElementById(id)?.remove(); };
    }, [l.styleSheet, l.name]);

    if (!l.visible) return null;

    let left = l.x, top = l.y, width = l.width, height = l.height;
    // Qt: once a stylesheet is set, the widget's palette/autoFillBackground are
    // ignored — the QSS governs background entirely, defaulting to transparent
    // when no `background-*` is declared. So skip the fillBackground/setColor
    // fallback whenever a stylesheet is present, otherwise an unrelated CSS
    // (e.g. `border: 0`) would leave a stale white fill hiding the parent
    // label's texture (matches Mudlet's QLabel + QSS behaviour).
    let inlineFromStylesheet: React.CSSProperties | undefined;
    if (l.styleSheet) {
        const parts = cssTextToParts(l.styleSheet);
        inlineFromStylesheet = parts.inline;
        // Qt's margin insets the visible widget area within its geometry; on
        // absolutely-positioned DOM elements, CSS margin instead offsets the
        // box, collapsing gaps between adjacent labels (e.g. gauges that share
        // an edge). Consume the margin into geometry so the visible rect
        // shrinks the way Mudlet renders it.
        if (parts.margin) {
            const m = parts.margin;
            left += m.left;
            top += m.top;
            width = Math.max(0, width - m.left - m.right);
            height = Math.max(0, height - m.top - m.bottom);
        }
    }

    const style: React.CSSProperties = {
        left, top, width, height,
        pointerEvents: l.clickThrough ? 'none' : 'auto',
        cursor: l.cursor ?? (l.onClick ? 'pointer' : undefined),
        zIndex: l.zIndex,
    };
    if (inlineFromStylesheet) {
        Object.assign(style, inlineFromStylesheet);
    } else if (l.fillBackground) {
        const bg = l.backgroundColor;
        style.background = bg
            ? `rgba(${bg.r},${bg.g},${bg.b},${bg.a / 255})`
            : '#fff';
    }
    // Layer setBackgroundImage on top so it shows over the fillBackground color
    // (and ignores it when a stylesheet already painted the background).
    if (l.backgroundImage) {
        const url = l.backgroundImage.url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        style.backgroundImage = `url("${url}")`;
        style.backgroundRepeat = 'no-repeat';
    }

    return (
        <div
            className="label"
            style={style}
            data-mudix-label={l.name}
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

