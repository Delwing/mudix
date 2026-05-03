import { Fragment, useRef } from 'react';
import type { DockSide, DragState, ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { DockedPanel } from './DockedPanel';

interface SplitGroupPanelProps {
    side: DockSide;
    panels: ScriptWindowRenderData[];
    splitGroupId: string;
    manager: WindowManager;
    onDragStateChange: (ds: DragState | null) => void;
    onTitlebarContextMenu: (e: React.MouseEvent) => void;
}

export function SplitGroupPanel({ side, panels, splitGroupId, manager, onDragStateChange, onTitlebarContextMenu }: SplitGroupPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    // For top/bottom dock areas, cross-axis splits stack vertically (column).
    // For left/right dock areas, they stack horizontally (row).
    const crossVertical = side === 'top' || side === 'bottom';

    const sorted = [...panels].sort((a, b) => (a.splitOrder ?? 0) - (b.splitOrder ?? 0));

    const handleSplitterDown = (aboveId: string, belowId: string) =>
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const aboveEl = containerRef.current?.querySelector<HTMLElement>(`[data-split-panel="${aboveId}"]`);
            const belowEl = containerRef.current?.querySelector<HTMLElement>(`[data-split-panel="${belowId}"]`);
            if (!aboveEl || !belowEl) return;

            const startPos       = crossVertical ? e.clientY : e.clientX;
            const startAboveSize = crossVertical ? aboveEl.offsetHeight : aboveEl.offsetWidth;
            const startBelowSize = crossVertical ? belowEl.offsetHeight : belowEl.offsetWidth;
            const totalSize      = startAboveSize + startBelowSize;
            const aWin0 = sorted.find(w => w.id === aboveId);
            const bWin0 = sorted.find(w => w.id === belowId);
            const totFlex = (aWin0?.splitFlex ?? 1) + (bWin0?.splitFlex ?? 1);

            const onMove = (ev: PointerEvent) => {
                const delta    = (crossVertical ? ev.clientY : ev.clientX) - startPos;
                const newAbove = Math.max(40, Math.min(totalSize - 40, startAboveSize + delta));
                const ratio    = newAbove / totalSize;
                aboveEl.style.flex = `${totFlex * ratio}`;
                belowEl.style.flex = `${totFlex * (1 - ratio)}`;
            };
            const onUp = (ev: PointerEvent) => {
                const delta    = (crossVertical ? ev.clientY : ev.clientX) - startPos;
                const newAbove = Math.max(40, Math.min(totalSize - 40, startAboveSize + delta));
                const ratio    = newAbove / totalSize;
                manager.setSplitFlex(aboveId, totFlex * ratio);
                manager.setSplitFlex(belowId, totFlex * (1 - ratio));
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        };

    const splitterClass = `split-group-splitter split-group-splitter--${crossVertical ? 'h' : 'v'}`;

    return (
        <div
            ref={containerRef}
            className={`split-group-panel split-group-panel--${crossVertical ? 'col' : 'row'}`}
        >
            {sorted.map((w, i) => (
                <Fragment key={w.id}>
                    <div
                        data-split-panel={w.id}
                        className="split-group-slot"
                        style={{ flex: w.splitFlex ?? 1, minHeight: 0, minWidth: 0 }}
                    >
                        <DockedPanel
                            id={w.id}
                            title={w.title}
                            kind={w.kind}
                            manager={manager}
                            onHide={() => manager.hide(w.id)}
                            onDragStateChange={onDragStateChange}
                            onTitlebarContextMenu={onTitlebarContextMenu}
                        />
                    </div>
                    {i < sorted.length - 1 && (
                        <div
                            className={splitterClass}
                            onPointerDown={handleSplitterDown(w.id, sorted[i + 1].id)}
                        />
                    )}
                </Fragment>
            ))}
        </div>
    );
}
