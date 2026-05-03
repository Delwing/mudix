import { Fragment, useMemo, useRef } from 'react';
import type { DockSide, DragState, ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { DockedPanel } from './DockedPanel';

interface DockAreaProps {
    side: DockSide;
    windows: ScriptWindowRenderData[];
    extent: number;
    dragState: DragState | null;
    manager: WindowManager;
    onSetExtent: (side: DockSide, n: number) => void;
    onDragStateChange: (ds: DragState | null) => void;
}

type DisplaySlot =
    | { isPreview: true;  id: string; flex: number }
    | { isPreview: false; id: string; flex: number; win: ScriptWindowRenderData };

export function DockArea({ side, windows, extent, dragState, manager, onSetExtent, onDragStateChange }: DockAreaProps) {
    const areaRef  = useRef<HTMLDivElement>(null);
    const horizontal = side === 'left' || side === 'right';

    const sorted: ScriptWindowRenderData[] = useMemo(() =>
        [...windows]
            .filter(w => w.docked === side && w.visible)
            .sort((a, b) => (a.dockOrder ?? 0) - (b.dockOrder ?? 0)),
        [windows, side],
    );

    // ── displaySlots — like arkadia: insert ghost at the right index ─────────

    const displaySlots: DisplaySlot[] = useMemo(() => {
        const isTarget    = dragState?.potentialDock === side;
        const insertIndex = isTarget ? (dragState!.insertSlotIndex ?? sorted.length) : null;

        if (!isTarget || insertIndex === null) {
            return sorted.map(w => ({ isPreview: false, id: w.id, flex: w.dockFlex ?? 1, win: w }));
        }

        // Insert preview with flex:1 — same value dock() assigns the new panel.
        // Existing panels keep their current flex, so the visual split matches reality exactly.
        const result: DisplaySlot[] = [];
        sorted.forEach((w, i) => {
            if (i === insertIndex) {
                result.push({ isPreview: true, id: `preview-${dragState!.panelId}`, flex: 1 });
            }
            result.push({ isPreview: false, id: w.id, flex: w.dockFlex ?? 1, win: w });
        });
        if (insertIndex >= sorted.length) {
            result.push({ isPreview: true, id: `preview-${dragState!.panelId}`, flex: 1 });
        }
        return result;
    }, [sorted, dragState, side]);

    // ── Edge splitter ─────────────────────────────────────────────────────────

    const handleEdgePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = areaRef.current;
        if (!el) return;
        const startPos  = horizontal ? e.clientX : e.clientY;
        const startSize = horizontal ? el.offsetWidth : el.offsetHeight;
        const flip      = (side === 'right' || side === 'bottom') ? -1 : 1;
        let lastSize    = startSize;
        const onMove = (ev: PointerEvent) => {
            lastSize = Math.max(80, startSize + ((horizontal ? ev.clientX : ev.clientY) - startPos) * flip);
            el.style[horizontal ? 'width' : 'height'] = `${lastSize}px`;
        };
        const onUp = () => {
            onSetExtent(side, lastSize);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    };

    // ── Inter-slot splitter ───────────────────────────────────────────────────

    const handleSlotSplitterDown = (aboveId: string, belowId: string) =>
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const aboveEl = areaRef.current?.querySelector<HTMLElement>(`[data-dock-panel="${aboveId}"]`);
            const belowEl = areaRef.current?.querySelector<HTMLElement>(`[data-dock-panel="${belowId}"]`);
            if (!aboveEl || !belowEl) return;
            const startPos       = horizontal ? e.clientY : e.clientX;
            const startAboveSize = horizontal ? aboveEl.offsetHeight : aboveEl.offsetWidth;
            const startBelowSize = horizontal ? belowEl.offsetHeight : belowEl.offsetWidth;
            const totalSize      = startAboveSize + startBelowSize;
            // Capture flex values at drag start — used to compute scaled flex during onMove.
            const aWin0  = sorted.find(w => w.id === aboveId);
            const bWin0  = sorted.find(w => w.id === belowId);
            const totFlex = (aWin0?.dockFlex ?? 1) + (bWin0?.dockFlex ?? 1);

            const onMove = (ev: PointerEvent) => {
                const delta    = (horizontal ? ev.clientY : ev.clientX) - startPos;
                const newAbove = Math.max(40, Math.min(totalSize - 40, startAboveSize + delta));
                const ratio    = newAbove / totalSize;
                // Set proportional flex values, NOT pixel values — otherwise the third
                // (and any other) panel collapses because its flex-grow stays at 1 while
                // these two jump to hundreds.
                aboveEl.style.flex = `${totFlex * ratio}`;
                belowEl.style.flex = `${totFlex * (1 - ratio)}`;
            };
            const onUp = (ev: PointerEvent) => {
                const delta    = (horizontal ? ev.clientY : ev.clientX) - startPos;
                const newAbove = Math.max(40, Math.min(totalSize - 40, startAboveSize + delta));
                const ratio    = newAbove / totalSize;
                manager.setDockFlex(aboveId, totFlex * ratio);
                manager.setDockFlex(belowId, totFlex * (1 - ratio));
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        };

    const edgeSplitClass   = `dock-edge-splitter dock-edge-splitter-${side}`;
    const slotSplitClass   = `dock-panel-splitter dock-panel-splitter-${horizontal ? 'h' : 'v'}`;

    // Real (non-preview) slots for splitter logic
    const realSlots = displaySlots.filter((s): s is Extract<DisplaySlot, { isPreview: false }> => !s.isPreview);

    return (
        <div
            ref={areaRef}
            className={`dock-area dock-area-${side}`}
            style={{ [horizontal ? 'width' : 'height']: extent }}
        >
            {displaySlots.map(slot => {
                if (slot.isPreview) {
                    return (
                        <div
                            key={slot.id}
                            className="dock-panel-slot dock-panel-slot--preview"
                            style={{ flex: slot.flex, minHeight: 0, minWidth: 0 }}
                        >
                            <div className="dock-drop-preview" />
                        </div>
                    );
                }

                const realIdx    = realSlots.findIndex(r => r.id === slot.id);
                const nextReal   = realSlots[realIdx + 1];
                const showSplit  = nextReal !== undefined &&
                    // Don't render splitter if there's a preview slot between them
                    displaySlots.indexOf(slot) + 1 < displaySlots.indexOf(nextReal);

                return (
                    <Fragment key={slot.id}>
                        <div
                            data-dock-panel={slot.id}
                            className="dock-panel-slot"
                            style={{ flex: slot.flex, minHeight: 0, minWidth: 0 }}
                        >
                            <DockedPanel
                                id={slot.id}
                                title={slot.win.title}
                                kind={slot.win.kind}
                                manager={manager}
                                onClose={() => manager.close(slot.id)}
                                onDragStateChange={onDragStateChange}
                            />
                        </div>
                        {/* Splitter between adjacent real slots (not next to preview) */}
                        {nextReal && !showSplit && (
                            <div
                                className={slotSplitClass}
                                onPointerDown={handleSlotSplitterDown(slot.id, nextReal.id)}
                            />
                        )}
                        {nextReal && showSplit && (
                            <div
                                className={slotSplitClass}
                                onPointerDown={handleSlotSplitterDown(slot.id, nextReal.id)}
                            />
                        )}
                    </Fragment>
                );
            })}
            <div className={edgeSplitClass} onPointerDown={handleEdgePointerDown} />
        </div>
    );
}
