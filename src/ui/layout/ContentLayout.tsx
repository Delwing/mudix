import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MudSession } from '../../mud/MudSession';
import type { DockSide, DragState, ScriptWindowRenderData } from '../windows/types';
import type { WindowManager } from '../windows/WindowManager';
import { OutputArea } from '../output/OutputArea';
import { DockArea } from './DockArea';
import { FloatingWindowLayer } from './FloatingWindowLayer';
import { TextPanel } from '../windows/panels/TextPanel';
import { HtmlPanel } from '../windows/panels/HtmlPanel';
import { MapPanel } from '../windows/panels/MapPanel';
import { DEFAULT_STICKY_LINES } from '../../hooks/useOutput';
import './ScriptWindow.css';

interface ContentLayoutProps {
    session: MudSession;
    manager: WindowManager;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

export function ContentLayout({
    session, manager,
    stickyLines = DEFAULT_STICKY_LINES,
    commandInputRef,
}: ContentLayoutProps) {
    const [windows,     setWindows]     = useState<ScriptWindowRenderData[]>([]);
    const [dockExtents, setDockExtents] = useState<Record<DockSide, number>>({
        left: 300, right: 300, top: 200, bottom: 200,
    });
    const [dragState,   setDragState]   = useState<DragState | null>(null);

    useEffect(() => {
        manager.onWindowsChange = (ws, extents) => {
            setWindows(ws);
            setDockExtents(extents);
        };
        // Deliver any windows that were opened before we subscribed (e.g. autoOpen
        // windows created by setWindowHints before ContentLayout mounted).
        manager.initialize();
        return () => { manager.onWindowsChange = undefined; };
    }, [manager]);

    const handleSetExtent = (side: DockSide, n: number) => {
        manager.setDockExtent(side, n);
        setDockExtents(prev => ({ ...prev, [side]: n }));
    };

    const dockAreaProps = { manager, dragState, onSetExtent: handleSetExtent, onDragStateChange: setDragState };

    const hasLeft   = windows.some(w => w.docked === 'left'   && w.visible);
    const hasRight  = windows.some(w => w.docked === 'right'  && w.visible);
    const hasTop    = windows.some(w => w.docked === 'top'    && w.visible);
    const hasBottom = windows.some(w => w.docked === 'bottom' && w.visible);

    // Show a DockArea when panels are present OR when drag is hovering over that side
    const showLeft   = hasLeft   || dragState?.potentialDock === 'left';
    const showRight  = hasRight  || dragState?.potentialDock === 'right';
    const showTop    = hasTop    || dragState?.potentialDock === 'top';
    const showBottom = hasBottom || dragState?.potentialDock === 'bottom';

    return (
        <div className="content-layout">
            {showTop && (
                <DockArea side="top" windows={windows} extent={dockExtents.top} {...dockAreaProps} />
            )}

            <div className="content-middle-row">
                {showLeft && (
                    <DockArea side="left" windows={windows} extent={dockExtents.left} {...dockAreaProps} />
                )}

                <div className="main-viewport">
                    <OutputArea session={session} stickyLines={stickyLines} commandInputRef={commandInputRef} />
                </div>

                {showRight && (
                    <DockArea side="right" windows={windows} extent={dockExtents.right} {...dockAreaProps} />
                )}
            </div>

            {showBottom && (
                <DockArea side="bottom" windows={windows} extent={dockExtents.bottom} {...dockAreaProps} />
            )}

            {/* Floating windows live in a position:fixed portal — completely independent of dock layout */}
            <FloatingWindowLayer
                windows={windows}
                manager={manager}
                onDragStateChange={setDragState}
            />

            {/* Content pool — one panel component per open window, mounted once for its lifetime.
                Each panel renders into a stable portal-target div that shells physically move
                between dock slots and floating frames without ever unmounting the component. */}
            {windows.map(w => createPortal(
                w.kind === 'text' ? <TextPanel id={w.id} manager={manager} />
              : w.kind === 'html' ? <HtmlPanel id={w.id} manager={manager} />
              : <MapPanel />,
                manager.getOrCreatePortalTarget(w.id),
                w.id,
            ))}
        </div>
    );
}
