import {type RefObject, useCallback, useEffect, useMemo} from 'react';
import {DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import './dockview-theme.css';
import type {MudSession} from '../../mud/MudSession';
import type {WindowManager} from './WindowManager';
import {OutputPanel} from './panels/OutputPanel';
import {TextPanel} from './panels/TextPanel';
import {HtmlPanel} from './panels/HtmlPanel';
import {MapPanel} from './panels/MapPanel';
import {PopoutButton} from './PopoutButton';
import {DEFAULT_STICKY_LINES} from '../../hooks/useOutput';

interface DockRootProps {
    session: MudSession;
    manager: WindowManager;
    stickyLines?: number;
    commandInputRef?: RefObject<HTMLInputElement>;
}

const OUTPUT_PANEL_ID = 'output';

export function DockRoot({
    session,
    manager,
    stickyLines = DEFAULT_STICKY_LINES,
    commandInputRef,
}: DockRootProps) {

    const components = useMemo(
        () => ({
            output: OutputPanel as React.FunctionComponent<IDockviewPanelProps>,
            text: TextPanel as React.FunctionComponent<IDockviewPanelProps>,
            html: HtmlPanel as React.FunctionComponent<IDockviewPanelProps>,
            map: MapPanel as React.FunctionComponent<IDockviewPanelProps>,
        }),
        [],
    );

    const handleReady = useCallback(
        (event: DockviewReadyEvent) => {
            const api = event.api;
            manager.attach(api);
            manager.registerOutputEntry(OUTPUT_PANEL_ID);

            api.addPanel({
                id: OUTPUT_PANEL_ID,
                component: 'output',
                title: 'Output',
                params: { session, stickyLines, commandInputRef },
            });

            // Output is a fixed region, not a window: lock its group so nothing
            // can be docked into it as a tab and hide the header so it has no
            // tab bar or close button. Other panels still dock around it.
            const outputPanel = api.getPanel(OUTPUT_PANEL_ID);
            if (outputPanel) {
                outputPanel.group.locked = 'no-drop-target';
                outputPanel.group.header.hidden = true;
            }


            // Allow dragging floating panels by their tab, not just the void area.
            // dockview's built-in drag handle is .dv-void-container only; we add
            // pointer handlers on the full tab header so the entire title bar works.
            const floatingDragCleanups = new Map<string, () => void>();

            const attachFloatingDrag = (group: (typeof api.groups)[number]) => {
                const header = group.element.querySelector<HTMLElement>('.dv-tabs-and-actions-container');
                if (!header) return;

                let active: {
                    pointerId: number;
                    panelEl: HTMLElement;
                    containerEl: HTMLElement;
                    offsetX: number;
                    offsetY: number;
                } | null = null;

                const onDown = (e: PointerEvent) => {
                    if (e.button !== 0 || e.shiftKey) return;
                    if (!(e.target as HTMLElement).closest('.dv-tab')) return;
                    if ((e.target as HTMLElement).closest('button, .dv-default-tab-action')) return;

                    const panelEl = group.element.closest<HTMLElement>('.dv-resize-container');
                    const containerEl = panelEl?.parentElement;
                    if (!panelEl || !containerEl) return;

                    const r = panelEl.getBoundingClientRect();
                    active = { pointerId: e.pointerId, panelEl, containerEl, offsetX: e.clientX - r.left, offsetY: e.clientY - r.top };
                    header.setPointerCapture(e.pointerId);
                };

                const onMove = (e: PointerEvent) => {
                    if (!active || e.pointerId !== active.pointerId) return;
                    const cr = active.containerEl.getBoundingClientRect();
                    active.panelEl.style.left = `${e.clientX - cr.left - active.offsetX}px`;
                    active.panelEl.style.top = `${e.clientY - cr.top - active.offsetY}px`;
                    active.panelEl.style.right = 'auto';
                    active.panelEl.style.bottom = 'auto';
                };

                const onUp = (e: PointerEvent) => {
                    if (active?.pointerId === e.pointerId) {
                        header.releasePointerCapture(e.pointerId);
                        active = null;
                    }
                };

                header.addEventListener('pointerdown', onDown);
                header.addEventListener('pointermove', onMove);
                header.addEventListener('pointerup', onUp);
                header.addEventListener('pointercancel', onUp);

                floatingDragCleanups.set(group.id, () => {
                    header.removeEventListener('pointerdown', onDown);
                    header.removeEventListener('pointermove', onMove);
                    header.removeEventListener('pointerup', onUp);
                    header.removeEventListener('pointercancel', onUp);
                });
            };

            for (const group of api.groups) {
                if (group.api.location.type === 'floating') {
                    requestAnimationFrame(() => attachFloatingDrag(group));
                }
            }

            const addGroupSub = api.onDidAddGroup((group) => {
                if (group.api.location.type === 'floating') {
                    requestAnimationFrame(() => attachFloatingDrag(group));
                }
            });

            const removeGroupSub = api.onDidRemoveGroup((group) => {
                floatingDragCleanups.get(group.id)?.();
                floatingDragCleanups.delete(group.id);
            });

            // Dispose subscriptions when this DockRoot unmounts.
            return () => {
                addGroupSub.dispose();
                removeGroupSub.dispose();
                floatingDragCleanups.forEach(fn => fn());
            };
        },
        [manager, session, stickyLines, commandInputRef],
    );

    useEffect(() => {
        return () => {
            manager.detach();
        };
    }, [manager]);

    return (
        <div className="dock-root-wrap">
            <DockviewReact
                className="dock-root dockview-theme-dark dockview-theme-mudix"
                components={components}
                rightHeaderActionsComponent={PopoutButton}
                onReady={handleReady}
            />
        </div>
    );
}

