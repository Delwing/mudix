import { Fragment, useMemo, useRef } from 'react';
import type { DockSide, DragState, ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { DockedPanel } from './DockedPanel';
import { TabGroupPanel } from './TabGroupPanel';
import { SplitGroupPanel } from './SplitGroupPanel';

interface DockAreaProps {
    side: DockSide;
    windows: ScriptWindowRenderData[];
    extent: number;
    dragState: DragState | null;
    manager: WindowManager;
    onSetExtent: (side: DockSide, n: number) => void;
    onDragStateChange: (ds: DragState | null) => void;
    onTitlebarContextMenu: (e: React.MouseEvent) => void;
}

type SlotKind = 'single' | 'tabs' | 'split';

/** A logical slot — one panel, a tab group, or a cross-axis split group. */
type DockSlot = {
    id: string;       // panel ID (single), dockGroup ID (tabs), or splitGroup ID (split)
    targetId: string; // panel ID for drag-target attribute
    flex: number;
    kind: SlotKind;
    panels: ScriptWindowRenderData[];
    activeId?: string;  // active tab (tabs only)
};

type DisplaySlot =
    | { isPreview: true; id: string; flex: number }
    | {
        isPreview: false;
        id: string; targetId: string; flex: number; kind: SlotKind;
        panels: ScriptWindowRenderData[]; activeId?: string;
        isStackTarget: boolean;
        isSplitTarget: boolean; splitBefore?: boolean;
      };

export function DockArea({ side, windows, extent, dragState, manager, onSetExtent, onDragStateChange, onTitlebarContextMenu }: DockAreaProps) {
    const areaRef    = useRef<HTMLDivElement>(null);
    const horizontal = side === 'left' || side === 'right';

    // ── sorted panels for this side ──────────────────────────────────────────

    const sorted: ScriptWindowRenderData[] = useMemo(() =>
        [...windows]
            .filter(w => w.docked === side && w.visible)
            .sort((a, b) => (a.dockOrder ?? 0) - (b.dockOrder ?? 0)),
        [windows, side],
    );

    // ── group panels into logical slots ──────────────────────────────────────

    const slots: DockSlot[] = useMemo(() => {
        const result: DockSlot[] = [];
        const seenGroups = new Set<string>();

        for (const w of sorted) {
            if (w.dockGroup) {
                if (seenGroups.has(w.dockGroup)) continue;
                seenGroups.add(w.dockGroup);
                const group  = sorted.filter(p => p.dockGroup === w.dockGroup).sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0));
                const active = group.find(p => p.isActiveTab) ?? group[0];
                result.push({ id: w.dockGroup, targetId: active.id, flex: w.dockFlex ?? 1, kind: 'tabs', panels: group, activeId: active.id });
            } else if (w.splitGroup) {
                if (seenGroups.has(w.splitGroup)) continue;
                seenGroups.add(w.splitGroup);
                const group = sorted.filter(p => p.splitGroup === w.splitGroup).sort((a, b) => (a.splitOrder ?? 0) - (b.splitOrder ?? 0));
                result.push({ id: w.splitGroup, targetId: group[0].id, flex: w.dockFlex ?? 1, kind: 'split', panels: group });
            } else {
                result.push({ id: w.id, targetId: w.id, flex: w.dockFlex ?? 1, kind: 'single', panels: [w] });
            }
        }
        return result;
    }, [sorted]);

    // ── displaySlots ─────────────────────────────────────────────────────────

    const displaySlots: DisplaySlot[] = useMemo(() => {
        const isTarget    = dragState?.potentialDock === side;
        const isStackDrop = isTarget && !!dragState?.stackTargetId;
        const isSplitDrop = isTarget && !!dragState?.splitTargetId;
        const insertIndex = isTarget && !isStackDrop && !isSplitDrop ? (dragState!.insertSlotIndex ?? slots.length) : null;

        const plain = (s: DockSlot): Extract<DisplaySlot, { isPreview: false }> => ({
            isPreview: false, ...s, isStackTarget: false, isSplitTarget: false,
        });

        if (!isTarget) return slots.map(plain);

        if (isStackDrop) {
            return slots.map(s => ({
                ...plain(s),
                isStackTarget: s.targetId === dragState!.stackTargetId
                    || s.panels.some(p => p.id === dragState!.stackTargetId),
            }));
        }

        if (isSplitDrop) {
            return slots.map(s => ({
                ...plain(s),
                isSplitTarget: s.targetId === dragState!.splitTargetId
                    || s.panels.some(p => p.id === dragState!.splitTargetId),
                splitBefore: dragState!.splitBefore,
            }));
        }

        // Ghost slot for positional insert
        const result: DisplaySlot[] = [];
        slots.forEach((s, i) => {
            if (i === insertIndex) result.push({ isPreview: true, id: `preview-${dragState!.panelId}`, flex: 1 });
            result.push(plain(s));
        });
        if (insertIndex! >= slots.length) result.push({ isPreview: true, id: `preview-${dragState!.panelId}`, flex: 1 });
        return result;
    }, [slots, dragState, side]);

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

    const handleSlotSplitterDown = (aboveSlotId: string, belowSlotId: string) =>
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const aboveEl = areaRef.current?.querySelector<HTMLElement>(`[data-dock-slot="${aboveSlotId}"]`);
            const belowEl = areaRef.current?.querySelector<HTMLElement>(`[data-dock-slot="${belowSlotId}"]`);
            if (!aboveEl || !belowEl) return;
            const startPos       = horizontal ? e.clientY : e.clientX;
            const startAboveSize = horizontal ? aboveEl.offsetHeight : aboveEl.offsetWidth;
            const startBelowSize = horizontal ? belowEl.offsetHeight : belowEl.offsetWidth;
            const totalSize      = startAboveSize + startBelowSize;
            const aSlot0   = slots.find(s => s.id === aboveSlotId);
            const bSlot0   = slots.find(s => s.id === belowSlotId);
            const totFlex  = (aSlot0?.flex ?? 1) + (bSlot0?.flex ?? 1);

            const onMove = (ev: PointerEvent) => {
                const delta    = (horizontal ? ev.clientY : ev.clientX) - startPos;
                const newAbove = Math.max(40, Math.min(totalSize - 40, startAboveSize + delta));
                const ratio    = newAbove / totalSize;
                aboveEl.style.flex = `${totFlex * ratio}`;
                belowEl.style.flex = `${totFlex * (1 - ratio)}`;
            };
            const onUp = (ev: PointerEvent) => {
                const delta    = (horizontal ? ev.clientY : ev.clientX) - startPos;
                const newAbove = Math.max(40, Math.min(totalSize - 40, startAboveSize + delta));
                const ratio    = newAbove / totalSize;
                manager.setSlotFlex(aboveSlotId, totFlex * ratio);
                manager.setSlotFlex(belowSlotId, totFlex * (1 - ratio));
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        };

    const edgeSplitClass = `dock-edge-splitter dock-edge-splitter-${side}`;
    const slotSplitClass = `dock-panel-splitter dock-panel-splitter-${horizontal ? 'h' : 'v'}`;
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

                const realIdx  = realSlots.findIndex(r => r.id === slot.id);
                const nextReal = realSlots[realIdx + 1];

                const slotClass = [
                    'dock-panel-slot',
                    slot.isStackTarget ? 'dock-panel-slot--stack-target' : '',
                ].filter(Boolean).join(' ');

                // Cross-axis split preview: temporarily split the slot 50/50 between
                // a ghost and the existing content so the preview matches the real result.
                const crossVertical = side === 'top' || side === 'bottom';

                const panelContent = slot.kind === 'tabs' ? (
                    <TabGroupPanel
                        side={side}
                        panels={slot.panels}
                        activeId={slot.activeId!}
                        manager={manager}
                        onDragStateChange={onDragStateChange}
                        onTitlebarContextMenu={onTitlebarContextMenu}
                    />
                ) : slot.kind === 'split' ? (
                    <SplitGroupPanel
                        side={side}
                        panels={slot.panels}
                        splitGroupId={slot.id}
                        manager={manager}
                        onDragStateChange={onDragStateChange}
                        onTitlebarContextMenu={onTitlebarContextMenu}
                    />
                ) : (
                    <DockedPanel
                        id={slot.id}
                        title={slot.panels[0].title}
                        kind={slot.panels[0].kind}
                        manager={manager}
                        onHide={() => manager.hide(slot.id)}
                        onDragStateChange={onDragStateChange}
                        onTitlebarContextMenu={onTitlebarContextMenu}
                    />
                );

                const ghostEl = (
                    <div className="dock-panel-slot dock-panel-slot--preview" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                        <div className="dock-drop-preview" />
                    </div>
                );

                const slotInner = slot.isSplitTarget ? (
                    <div style={{ display: 'flex', flexDirection: crossVertical ? 'column' : 'row', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
                        {slot.splitBefore ? <>{ghostEl}<div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{panelContent}</div></> : <><div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{panelContent}</div>{ghostEl}</>}
                    </div>
                ) : panelContent;

                return (
                    <Fragment key={slot.id}>
                        <div
                            data-dock-slot={slot.id}
                            data-dock-panel={slot.targetId}
                            className={slotClass}
                            style={{ flex: slot.flex, minHeight: 0, minWidth: 0 }}
                        >
                            {slotInner}
                        </div>
                        {nextReal && (
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
