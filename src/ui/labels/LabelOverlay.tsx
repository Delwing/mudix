import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { LabelManager, LabelMouseEvent, LabelState, LabelWheelEvent } from './LabelManager';
import { cssTextToParts, qtDeclarationsToCss, cssEscape } from './qtCss';
import './LabelOverlay.css';

// Mudlet reports `event.button` as a Qt button *name string* (not an int) — see
// TLuaInterpreter `csmMouseButtons`. Geyser packages branch on these literals
// (`if event.button == "LeftButton"`), so we must hand Lua the same strings.
// DOM `e.button` is 0/1/2/3/4 for left/middle/right/back/forward.
const BUTTON_DOM_TO_MUDLET: Record<number, string> = {
    0: 'LeftButton', 1: 'MidButton', 2: 'RightButton', 3: 'BackButton', 4: 'ForwardButton',
};

// Mudlet's Qt `button()` is only the pressed/released button for
// press/release/click/double-click; for move/enter/leave it is Qt::NoButton.
// DOM move/enter/leave report `e.button === 0`, which we must not mistake for a
// left click — report "NoButton" there to match Mudlet. Exported pure so the
// DOM→Mudlet mapping (the part packages depend on) is unit-testable.
export function domButtonToMudlet(type: string, domButton: number): string {
    if (type === 'mousemove' || type === 'pointermove'
        || type === 'mouseenter' || type === 'mouseleave') return 'NoButton';
    return BUTTON_DOM_TO_MUDLET[domButton] ?? 'NoButton';
}

function buildMouseEvent(e: React.MouseEvent<HTMLDivElement>): LabelMouseEvent {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
        button:  domButtonToMudlet(e.type, e.button),
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
        button:  'NoButton',
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

    // Coalesce high-frequency pointermove into one dispatch per animation frame.
    // A drag fires pointermove at the display's refresh rate (120Hz+), and each
    // event runs the label's (often expensive) Lua move callback — e.g. Geyser
    // pane-drag repositions a whole widget subtree. Running that per event makes
    // dragging stutter; running it once per frame is visually identical and is
    // what Qt does (it compresses pending mouse-move events). `pending` holds the
    // latest already-built event so the frame uses the freshest position.
    const moveState = useRef<{ raf: number | null; pending: LabelMouseEvent | null }>({ raf: null, pending: null });
    useEffect(() => () => {
        if (moveState.current.raf !== null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(moveState.current.raf);
        }
    }, []);

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

    // Mudlet setLinkStyle: color/underline the <a> links in the label's HTML.
    // Scoped via the same data-attribute selector as the stylesheet block.
    const linkStyle = l.linkStyle;
    useEffect(() => {
        if (!linkStyle) return;
        const id = `mudix-label-linkstyle--${l.name}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
        }
        const sel = `[data-mudix-label="${cssEscape(l.name)}"] a`;
        const decl: string[] = [`text-decoration: ${linkStyle.underline ? 'underline' : 'none'}`];
        if (linkStyle.color) decl.push(`color: ${linkStyle.color}`);
        el.textContent =
            `${sel} { ${decl.join('; ')} }` +
            (linkStyle.visitedColor ? `\n${sel}:visited { color: ${linkStyle.visitedColor} }` : '');
        return () => { document.getElementById(id)?.remove(); };
    }, [linkStyle, l.name]);

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

    // Mudlet semantics (TLabel): the click callback fires on mouse PRESS
    // (mousePressEvent), and Qt grabs the mouse from press until release so the
    // move/release callbacks keep firing even when the cursor leaves the widget.
    // We mirror both with pointer events: fire onClick on pointerdown, and when
    // the label is drag-capable (has a move or release callback) capture the
    // pointer so onPointerMove/onPointerUp track outside the label's bounds.
    // Without this, dragging a Geyser pane titlebar stutters and stops the
    // instant the cursor leaves the titlebar.
    const dragCapable = !!(l.onMouseMove || l.onMouseUp);
    const hasPress = !!(l.onClick || l.onMouseDown) || dragCapable;
    const onPointerDown = hasPress
        ? (e: React.PointerEvent<HTMLDivElement>) => {
            if (dragCapable) {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
            }
            ref.current.onMouseDown?.(buildMouseEvent(e));
            ref.current.onClick?.(buildMouseEvent(e));
        }
        : undefined;

    const flushMove = () => {
        const st = moveState.current;
        st.raf = null;
        const ev = st.pending;
        st.pending = null;
        if (ev) ref.current.onMouseMove?.(ev);
    };
    const onPointerMove = l.onMouseMove
        ? (e: React.PointerEvent<HTMLDivElement>) => {
            // rAF unavailable (SSR/tests) → dispatch synchronously.
            if (typeof requestAnimationFrame === 'undefined') {
                ref.current.onMouseMove?.(buildMouseEvent(e));
                return;
            }
            moveState.current.pending = buildMouseEvent(e);
            if (moveState.current.raf === null) {
                moveState.current.raf = requestAnimationFrame(flushMove);
            }
        }
        : undefined;
    const onPointerUp = l.onMouseUp
        ? (e: React.PointerEvent<HTMLDivElement>) => {
            // Flush any frame-pending move first so the release sees the final
            // drag position (e.g. the insertion target picked on the last move),
            // then drop the scheduled frame.
            const st = moveState.current;
            if (st.raf !== null && typeof cancelAnimationFrame !== 'undefined') {
                cancelAnimationFrame(st.raf);
                st.raf = null;
            }
            if (st.pending) { const ev = st.pending; st.pending = null; ref.current.onMouseMove?.(ev); }
            ref.current.onMouseUp?.(buildMouseEvent(e));
        }
        : undefined;

    return (
        <div
            className="label"
            style={style}
            data-mudix-label={l.name}
            title={l.tooltip}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerMove={onPointerMove}
            onDoubleClick={l.onDoubleClick && (e => ref.current.onDoubleClick?.(buildMouseEvent(e)))}
            onMouseEnter={l.onMouseEnter && (e => ref.current.onMouseEnter?.(buildMouseEvent(e)))}
            onMouseLeave={l.onMouseLeave && (e => ref.current.onMouseLeave?.(buildMouseEvent(e)))}
            onWheel={l.onWheel && (e => ref.current.onWheel?.(buildWheelEvent(e)))}
            dangerouslySetInnerHTML={{ __html: l.html }}
        />
    );
}

