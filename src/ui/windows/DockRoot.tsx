import {type RefObject, useCallback, useEffect, useMemo, useRef} from 'react';
import {DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import './dockview-theme.css';
import type {MudSession} from '../../mud/MudSession';
import type {WindowManager} from './WindowManager';
import type {SerializedLayout} from './types';
import {OutputPanel} from './panels/OutputPanel';
import {TextPanel} from './panels/TextPanel';
import {HtmlPanel} from './panels/HtmlPanel';
import {MapPanel} from './panels/MapPanel';

interface DockRootProps {
    session: MudSession;
    manager: WindowManager;
    stickyLines?: number;
    initialLayout?: SerializedLayout | null;
    onLayoutChange?: (layout: SerializedLayout) => void;
    commandInputRef?: RefObject<HTMLInputElement>;
}

const SAVE_DEBOUNCE_MS = 400;
const OUTPUT_PANEL_ID = 'output';

export function DockRoot({
    session,
    manager,
    stickyLines = 5,
    initialLayout,
    onLayoutChange,
    commandInputRef,
}: DockRootProps) {
    const saveTimerRef = useRef<number | null>(null);
    const onLayoutChangeRef = useRef(onLayoutChange);
    onLayoutChangeRef.current = onLayoutChange;

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

            const seedDefaultLayout = () => {
                api.addPanel({
                    id: OUTPUT_PANEL_ID,
                    component: 'output',
                    title: 'Output',
                    params: { session, stickyLines, commandInputRef },
                });
            };

            if (initialLayout) {
                try {
                    api.fromJSON(
                        injectOutputParams(initialLayout, { session, stickyLines, manager, commandInputRef }),
                    );
                    if (!api.getPanel(OUTPUT_PANEL_ID)) seedDefaultLayout();
                } catch {
                    api.clear();
                    seedDefaultLayout();
                }
            } else {
                seedDefaultLayout();
            }

            // Output is a fixed region, not a window: lock its group so nothing
            // can be docked into it as a tab and hide the header so it has no
            // tab bar or close button. Other panels still dock around it.
            const outputPanel = api.getPanel(OUTPUT_PANEL_ID);
            if (outputPanel) {
                outputPanel.group.locked = 'no-drop-target';
                outputPanel.group.header.hidden = true;
            }

            const sub = api.onDidLayoutChange(() => {
                if (!onLayoutChangeRef.current) return;
                if (saveTimerRef.current !== null) {
                    window.clearTimeout(saveTimerRef.current);
                }
                saveTimerRef.current = window.setTimeout(() => {
                    onLayoutChangeRef.current?.(stripLiveParams(api.toJSON()));
                    saveTimerRef.current = null;
                }, SAVE_DEBOUNCE_MS);
            });

            // Dispose subscription when this DockRoot unmounts.
            return () => sub.dispose();
        },
        [manager, session, stickyLines, initialLayout],
    );

    useEffect(() => {
        return () => {
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            manager.detach();
        };
    }, [manager]);

    return (
        <div className="dock-root-wrap">
            <DockviewReact
                className="dock-root dockview-theme-mudix"
                components={components}
                onReady={handleReady}
            />
        </div>
    );
}

const LIVE_PARAM_KEYS = new Set(['session', 'manager', 'commandInputRef']);

/** Strip non-serializable live references from panel params before persisting. */
function stripLiveParams(layout: SerializedLayout): SerializedLayout {
    return JSON.parse(JSON.stringify(layout, (key, value) => {
        if (LIVE_PARAM_KEYS.has(key)) return undefined;
        return value;
    })) as SerializedLayout;
}

/**
 * Persisted layouts only contain serializable data, so live references
 * (MudSession, WindowManager) are dropped on save. Re-inject them based on
 * each panel's component before handing the layout back to Dockview.
 */
function injectOutputParams(
    layout: SerializedLayout,
    params: {
        session: MudSession;
        stickyLines: number;
        manager: WindowManager;
        commandInputRef?: RefObject<HTMLInputElement>;
    },
): SerializedLayout {
    const cloned = JSON.parse(JSON.stringify(layout)) as SerializedLayout;
    const panels = cloned.panels as
        | Record<string, { contentComponent?: string; params?: Record<string, unknown> }>
        | undefined;
    if (!panels) return cloned;
    for (const id of Object.keys(panels)) {
        const panel = panels[id];
        if (id === OUTPUT_PANEL_ID || panel.contentComponent === 'output') {
            panel.params = { session: params.session, stickyLines: params.stickyLines, commandInputRef: params.commandInputRef };
        } else {
            panel.params = { ...(panel.params ?? {}), manager: params.manager };
        }
    }
    return cloned;
}
