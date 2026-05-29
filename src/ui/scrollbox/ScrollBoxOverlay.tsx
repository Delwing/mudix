import { useEffect, useState } from 'react';
import type React from 'react';
import type { ScrollBoxManager, ScrollBoxState } from './ScrollBoxManager';
import type { LabelManager } from '../labels/LabelManager';
import type { CommandLineManager } from '../cmdline/CommandLineManager';
import { LabelOverlay } from '../labels/LabelOverlay';
import { CommandLineOverlay } from '../cmdline/CommandLineOverlay';
import './ScrollBoxOverlay.css';

interface ScrollBoxOverlayProps {
    manager: ScrollBoxManager;
    labels: LabelManager;
    cmdLines: CommandLineManager;
    /** Viewport whose scroll boxes this overlay renders ('main', a userwindow
     *  id, or — when nested — another scroll box's name). */
    parent: string;
}

/**
 * Renders the {@link ScrollBoxManager}'s boxes for a given parent viewport as
 * absolutely-positioned scrollable containers. Each box hosts the child overlays
 * (labels, command lines, and nested scroll boxes) scoped to the box's own name,
 * so widgets created with `parent = boxName` render inside it.
 *
 * Scrolling: the children are absolutely positioned and don't expand their
 * containers on their own, so each box wraps them in a content div sized to the
 * extent of its children (the furthest child edge). When that extent exceeds the
 * box, the box's `overflow:auto` produces real scrollbars.
 */
export function ScrollBoxOverlay({ manager, labels, cmdLines, parent }: ScrollBoxOverlayProps) {
    // Optional chaining keeps the hooks unconditional while tolerating a
    // transiently-absent manager — e.g. a Fast-Refresh-retained MudSession from
    // before scrollBoxes existed. A hard reload restores the real manager.
    const [boxes, setBoxes] = useState<ScrollBoxState[]>(() => manager?.list(parent) ?? []);
    useEffect(() => manager?.subscribe(parent, setBoxes), [manager, parent]);
    if (!manager || !labels || !cmdLines || boxes.length === 0) return null;
    return (
        <>
            {boxes.map(sb => (
                <ScrollBox key={sb.name} sb={sb} manager={manager} labels={labels} cmdLines={cmdLines} />
            ))}
        </>
    );
}

function ScrollBox({ sb, manager, labels, cmdLines }: { sb: ScrollBoxState; manager: ScrollBoxManager; labels: LabelManager; cmdLines: CommandLineManager }) {
    // Track the children parented to this box across all three overlay managers
    // so we can size the scroll content to their extent. Each child kind exposes
    // {x, y, width, height}; the content box grows to the furthest edge.
    const [childLabels, setChildLabels] = useState(() => labels.list(sb.name));
    const [childCmdLines, setChildCmdLines] = useState(() => cmdLines.list(sb.name));
    const [childBoxes, setChildBoxes] = useState(() => manager.list(sb.name));
    useEffect(() => labels.subscribe(sb.name, setChildLabels), [labels, sb.name]);
    useEffect(() => cmdLines.subscribe(sb.name, setChildCmdLines), [cmdLines, sb.name]);
    useEffect(() => manager.subscribe(sb.name, setChildBoxes), [manager, sb.name]);

    if (!sb.visible) return null;

    let maxRight = 0;
    let maxBottom = 0;
    for (const c of [...childLabels, ...childCmdLines, ...childBoxes]) {
        if (c.x + c.width > maxRight) maxRight = c.x + c.width;
        if (c.y + c.height > maxBottom) maxBottom = c.y + c.height;
    }

    const overflowsX = maxRight > sb.width;
    const overflowsY = maxBottom > sb.height;
    const style: React.CSSProperties = {
        left: sb.x, top: sb.y, width: sb.width, height: sb.height,
        zIndex: sb.zIndex,
        // Only scroll an axis whose children actually overflow — otherwise a
        // box that fits its content must show NO scrollbar (and not have its
        // content squeezed by a scrollbar that shouldn't be there).
        overflowX: overflowsX ? 'auto' : 'hidden',
        overflowY: overflowsY ? 'auto' : 'hidden',
    };
    // Grow the content only on axes where children overflow the box; otherwise
    // stay at 100% so a scrollbar on one axis doesn't spawn a spurious one on
    // the other.
    const contentStyle: React.CSSProperties = {
        width: overflowsX ? maxRight : '100%',
        height: overflowsY ? maxBottom : '100%',
    };

    return (
        <div className="scrollbox-overlay" data-mudix-scrollbox={sb.name} style={style}>
            <div className="scrollbox-content" style={contentStyle}>
                {/* Children are positioned relative to this content box. */}
                <LabelOverlay manager={labels} parent={sb.name} />
                <CommandLineOverlay manager={cmdLines} parent={sb.name} />
                <ScrollBoxOverlay manager={manager} labels={labels} cmdLines={cmdLines} parent={sb.name} />
            </div>
        </div>
    );
}
