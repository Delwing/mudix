import { Fragment, useRef } from 'react';
import type { DockSide, DragState, ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { DockedPanel } from './DockedPanel';
import { TabGroupPanel } from './TabGroupPanel';

interface SplitGroupPanelProps {
    side: DockSide;
    panels: ScriptWindowRenderData[];
    splitGroupId: string;
    manager: WindowManager;
    onDragStateChange: (ds: DragState | null) => void;
    onTitlebarContextMenu: (e: React.MouseEvent) => void;
    /** Panel ID hovered for a tab-stack drop — highlights only that sub-panel. */
    stackTargetId?: string;
    /** Panel ID targeted for a within-split insert — shows ghost between members. */
    splitTargetId?: string;
    splitBefore?: boolean;
}

type SplitMember =
    | { kind: 'single'; id: string; panel: ScriptWindowRenderData; splitFlex: number }
    | { kind: 'tabs';   id: string; panels: ScriptWindowRenderData[]; activeId: string; splitFlex: number };

type DisplayItem = SplitMember | { kind: 'preview'; id: string; splitTargetId: string; splitBefore: boolean };

export function SplitGroupPanel({ side, panels, manager, onDragStateChange, onTitlebarContextMenu, stackTargetId, splitTargetId, splitBefore }: SplitGroupPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const crossVertical = side === 'top' || side === 'bottom';

    const sorted = [...panels].sort((a, b) => (a.splitOrder ?? 0) - (b.splitOrder ?? 0));

    // Group by splitOrder — tab group members sharing the same order render as one slot
    const members: SplitMember[] = [];
    const seenOrders = new Set<number>();
    for (const w of sorted) {
        const order = w.splitOrder ?? 0;
        if (seenOrders.has(order)) continue;
        seenOrders.add(order);
        const atOrder = sorted.filter(p => (p.splitOrder ?? 0) === order);
        if (w.dockGroup) {
            const tabPanels = atOrder.sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0));
            const activeId  = tabPanels.find(p => p.isActiveTab)?.id ?? tabPanels[0].id;
            members.push({ kind: 'tabs', id: tabPanels[0].id, panels: tabPanels, activeId, splitFlex: w.splitFlex ?? 1 });
        } else {
            members.push({ kind: 'single', id: w.id, panel: w, splitFlex: w.splitFlex ?? 1 });
        }
    }

    // Build display list: insert inner preview ghost at the correct position
    const displayItems: DisplayItem[] = [];
    if (splitTargetId) {
        const targetIdx = members.findIndex(m =>
            m.kind === 'single'
                ? m.panel.id === splitTargetId
                : m.panels.some(p => p.id === splitTargetId)
        );
        if (targetIdx >= 0) {
            members.forEach((m, i) => {
                if (splitBefore && i === targetIdx) {
                    // Key by the insertion gap (prev–next pair), not by splitTargetId.
                    // "split after A" and "split before B" land at the same gap so they
                    // share the same key, preventing React from recreating the ghost element
                    // when the target oscillates between the two equivalent states.
                    const prev = members[i - 1];
                    displayItems.push({ kind: 'preview', id: `preview-${prev?.id ?? 'start'}-${m.id}`, splitTargetId, splitBefore: true });
                }
                displayItems.push(m);
                if (!splitBefore && i === targetIdx) {
                    const next = members[i + 1];
                    displayItems.push({ kind: 'preview', id: `preview-${m.id}-${next?.id ?? 'end'}`, splitTargetId, splitBefore: false });
                }
            });
        } else {
            displayItems.push(...members);
        }
    } else {
        displayItems.push(...members);
    }

    // Helper: next non-preview item after index i
    const nextRealAfter = (i: number): SplitMember | undefined => {
        for (let j = i + 1; j < displayItems.length; j++) {
            const item = displayItems[j];
            if (item.kind !== 'preview') return item as SplitMember;
        }
        return undefined;
    };

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
            const aMember = members.find(m => m.id === aboveId);
            const bMember = members.find(m => m.id === belowId);
            const totFlex  = (aMember?.splitFlex ?? 1) + (bMember?.splitFlex ?? 1);

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
            {displayItems.map((item, i) => {
                if (item.kind === 'preview') {
                    return (
                        <div
                            key={item.id}
                            className="split-group-slot split-group-slot--preview"
                            data-split-target={item.splitTargetId}
                            data-split-before={item.splitBefore ? 'true' : 'false'}
                            style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                        >
                            <div className="dock-drop-preview" />
                        </div>
                    );
                }

                const member = item;
                const nextReal = nextRealAfter(i);
                const isStackTarget = !!stackTargetId && (
                    member.kind === 'single'
                        ? stackTargetId === member.panel.id
                        : member.panels.some(p => p.id === stackTargetId)
                );

                return (
                    <Fragment key={member.id}>
                        <div
                            data-split-panel={member.id}
                            className={['split-group-slot', isStackTarget ? 'dock-panel-slot--stack-target' : ''].filter(Boolean).join(' ')}
                            style={{ flex: member.splitFlex, minHeight: 0, minWidth: 0 }}
                        >
                            {member.kind === 'tabs' ? (
                                <TabGroupPanel
                                    side={side}
                                    panels={member.panels}
                                    activeId={member.activeId}
                                    manager={manager}
                                    onDragStateChange={onDragStateChange}
                                    onTitlebarContextMenu={onTitlebarContextMenu}
                                />
                            ) : (
                                <DockedPanel
                                    id={member.panel.id}
                                    title={member.panel.title}
                                    kind={member.panel.kind}
                                    manager={manager}
                                    onHide={() => manager.hide(member.panel.id)}
                                    onDragStateChange={onDragStateChange}
                                    onTitlebarContextMenu={onTitlebarContextMenu}
                                />
                            )}
                        </div>
                        {nextReal && displayItems[i + 1]?.kind !== 'preview' && (
                            <div
                                className={splitterClass}
                                onPointerDown={handleSplitterDown(member.id, nextReal.id)}
                            />
                        )}
                    </Fragment>
                );
            })}
        </div>
    );
}
