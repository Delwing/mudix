import { useCallback, useEffect, useRef, useState } from 'react';
import { MapRenderer, createSettings } from 'mudlet-map-renderer';
import type { RoomContextMenuEventDetail } from 'mudlet-map-renderer';
import type { WindowManager } from '../WindowManager';
import type { MapEventEntry } from '../../../map/MapStore';
import { MudixMapReader } from '../../../map/MudixMapReader';
import { useAppStore } from '../../../storage';

type MapStatus = 'loading' | 'empty' | 'ready' | 'error';

interface MapPanelProps {
    id: string;
    manager: WindowManager;
    connectionId: string;
}

export function MapPanel({ id, manager, connectionId }: MapPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<MapRenderer | null>(null);
    const readerRef = useRef<MudixMapReader | null>(null);
    const prevWidthRef = useRef<number>(0);
    const needsFitRef = useRef<boolean>(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<MapStatus>('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [areas, setAreas] = useState<Array<{ id: number; name: string }>>([]);
    const [currentArea, setCurrentArea] = useState<number | null>(null);
    const [levels, setLevels] = useState<number[]>([]);
    const [currentLevel, setCurrentLevel] = useState<number>(0);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        roomId: number;
        items: MapEventEntry[];
    } | null>(null);

    // Refs mirror the latest area/level so callbacks captured at mount time
    // can see the current selection (state values would be stale captures).
    const currentAreaRef = useRef<number | null>(null);
    const currentLevelRef = useRef<number>(0);
    currentAreaRef.current = currentArea;
    currentLevelRef.current = currentLevel;

    // Saved view state snapshot — captured once on mount so the first
    // syncFromStore can restore area/level + zoom/pan instead of fitting.
    // Subsequent saves (camera/area/level changes) write back via
    // patchConnectionProfile; we don't re-read because that would clobber
    // the user's live pan/zoom whenever the store notifies.
    const savedViewRef = useRef(
        useAppStore.getState().connectionProfile[connectionId]?.mapViewState,
    );
    const saveTimerRef = useRef<number | null>(null);
    const saveViewState = useCallback(() => {
        if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            const renderer = rendererRef.current;
            const areaId = currentAreaRef.current;
            if (!renderer || areaId == null) return;
            const bounds = renderer.getViewportBounds();
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            const next = {
                areaId,
                level: currentLevelRef.current,
                zoom: renderer.getZoom(),
                centerX,
                centerY,
            };
            // Keep the live ref in sync so the dock-hide-then-show recovery
            // path (ResizeObserver else branch when container width transitions
            // through 0) re-applies the user's current view, not mount-time.
            savedViewRef.current = next;
            useAppStore.getState().patchConnectionProfile(connectionId, { mapViewState: next });
        }, 400);
    }, [connectionId]);

    // Refresh the live reader from MapStore and pick an area/level to display.
    // Used both on initial sync and on every store-change tick. Returns true
    // when the renderer was driven to a ready state; false when the store is
    // still empty (overlay stays up).
    const syncFromStore = useCallback((opts?: { keepArea?: number; keepLevel?: number }): boolean => {
        const reader = readerRef.current;
        const renderer = rendererRef.current;
        if (!reader || !renderer) return false;
        reader.refresh();

        const areaList = reader.getAreas()
            .map(a => ({ id: a.getAreaId(), name: a.getAreaName() }))
            .sort((a, b) => a.name.localeCompare(b.name));
        setAreas(areaList);

        if (areaList.length === 0) {
            setStatus('empty');
            return false;
        }

        // On first sync, fall through to the saved view state from a prior
        // session (if any) so the user keeps their area/level. The hint args
        // win when explicitly provided (e.g. centerview from script).
        const saved = needsFitRef.current ? undefined : savedViewRef.current;
        const keepArea = opts?.keepArea ?? currentAreaRef.current ?? saved?.areaId ?? undefined;
        const keepLevel = opts?.keepLevel ?? (currentAreaRef.current != null ? currentLevelRef.current : saved?.level);
        const restoredArea = keepArea != null && areaList.some(a => a.id === keepArea)
            ? keepArea
            : areaList[0].id;
        const areaLevels = reader.getArea(restoredArea).getZLevels().sort((a, b) => a - b);
        const restoredLevel =
            keepLevel != null && areaLevels.includes(keepLevel) ? keepLevel
            : areaLevels.includes(0) ? 0 : (areaLevels[0] ?? 0);
        setLevels(areaLevels);
        setCurrentLevel(restoredLevel);
        setCurrentArea(restoredArea);
        renderer.drawArea(restoredArea, restoredLevel);
        // Only fit on the first successful render; afterwards preserve user pan/zoom.
        // If we have a saved zoom/center for the same area we restored, apply
        // those instead of fitting (so the user lands on their last view).
        if (!needsFitRef.current) {
            needsFitRef.current = true;
            if (saved && saved.areaId === restoredArea && Number.isFinite(saved.zoom)) {
                renderer.setZoom(saved.zoom);
                renderer.camera.panToMapPoint(saved.centerX, saved.centerY);
            } else {
                renderer.fitArea();
            }
        }
        setStatus('ready');
        return true;
    }, []);

    // Construct the renderer + live reader exactly once. Subsequent store
    // mutations flow through `reader.refresh()` + `renderer.drawArea(...)` —
    // the Konva stage and event listeners stay alive across map reloads.
    useEffect(() => {
        if (!containerRef.current) return;
        const reader = new MudixMapReader(manager.mapStore);
        readerRef.current = reader;
        const settings = createSettings();
        settings.areaName = false;
        const renderer = new MapRenderer(reader, settings, containerRef.current);
        renderer.centerOnResize = false;
        rendererRef.current = renderer;

        renderer.backend.events.on('roomcontextmenu', (detail: RoomContextMenuEventDetail) => {
            const items = manager.mapStore.getMapEvents();
            if (items.length === 0) return;
            const rect = containerRef.current?.getBoundingClientRect();
            setContextMenu({
                x: (rect?.left ?? 0) + detail.position.x,
                y: (rect?.top ?? 0) + detail.position.y,
                roomId: detail.roomId,
                items,
            });
        });

        // Persist zoom/pan back to the profile whenever the camera moves.
        // Skipped until syncFromStore has applied saved/initial state so the
        // initial fitArea / restored-zoom doesn't trample a still-loading save.
        const onCameraChange = () => { if (needsFitRef.current) saveViewState(); };
        renderer.camera.on('change', onCameraChange);

        return () => {
            renderer.camera.off('change', onCameraChange);
            if (saveTimerRef.current != null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            renderer.destroy();
            rendererRef.current = null;
            readerRef.current = null;
        };
    }, [manager, saveViewState]);

    // Boot path: ScriptingEngine and this panel both call bootstrapMap; the
    // manager dedupes to a single IndexedDB fetch + parse. Once it resolves
    // (or fails) we sync from the now-populated MapStore.
    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        manager.bootstrapMap().then(() => {
            if (cancelled) return;
            try { syncFromStore(); }
            catch (e) {
                setErrorMsg(e instanceof Error ? e.message : String(e));
                setStatus('error');
            }
        });
        return () => { cancelled = true; };
    }, [manager, syncFromStore]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!dropdownOpen) return;
        const onDown = (e: MouseEvent) => {
            if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [dropdownOpen]);

    // Close hamburger menu on outside click
    useEffect(() => {
        if (!menuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [menuOpen]);

    // Close map context menu on outside click or scroll/resize
    useEffect(() => {
        if (!contextMenu) return;
        const onDown = (e: MouseEvent) => {
            const root = document.getElementById('mudix-map-context-menu');
            if (root && !root.contains(e.target as Node)) setContextMenu(null);
        };
        const onClose = () => setContextMenu(null);
        document.addEventListener('mousedown', onDown);
        window.addEventListener('resize', onClose);
        window.addEventListener('blur', onClose);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('blur', onClose);
        };
    }, [contextMenu]);

    // Divs don't fire "resize" natively; the renderer needs it to update canvas size.
    // After the canvas resizes, scale zoom proportionally to preserve visible world bounds
    // (same behavior as Mudlet: bigger window = zoom in, smaller = zoom out).
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const newWidth = entries[0].contentRect.width;
            const renderer = rendererRef.current;
            if (renderer && prevWidthRef.current > 0 && newWidth > 0) {
                const scale = newWidth / prevWidthRef.current;
                const zoom = renderer.getZoom();
                const bounds = renderer.getViewportBounds();
                const cx = (bounds.minX + bounds.maxX) / 2;
                const cy = (bounds.minY + bounds.maxY) / 2;
                el.dispatchEvent(new Event('resize'));
                renderer.setZoom(zoom * scale);
                renderer.camera.panToMapPoint(cx, cy);
            } else {
                el.dispatchEvent(new Event('resize'));
                // First time the canvas reaches non-zero width: re-apply the
                // initial view. syncFromStore may have already drawn the area
                // while the container was 0×0, which makes fit/zoom math
                // useless — redo it now that we have real dimensions. Prefer
                // the saved view over fitArea so we don't trample restored
                // zoom/pan when the dock layout settles late. Don't flip
                // needsFitRef back to false: a later store mutation could then
                // trigger another saved-state restore and wipe the user's
                // live pan/zoom.
                if (renderer && newWidth > 0 && needsFitRef.current) {
                    const saved = savedViewRef.current;
                    if (saved && currentAreaRef.current === saved.areaId && Number.isFinite(saved.zoom)) {
                        renderer.setZoom(saved.zoom);
                        renderer.camera.panToMapPoint(saved.centerX, saved.centerY);
                    } else {
                        renderer.fitArea();
                    }
                }
            }
            prevWidthRef.current = newWidth;
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Area/level changes don't always move the camera (e.g. level cycling via
    // ▲▼ buttons just redraws the same viewport), so the camera-change handler
    // would miss them. Gate on needsFitRef so we don't save before the first
    // sync has settled on real values.
    useEffect(() => {
        if (!needsFitRef.current || currentArea == null) return;
        saveViewState();
    }, [currentArea, currentLevel, saveViewState]);

    // Subscribe to MapStore changes (script-built rooms, binary load, etc.).
    // Each tick: refresh the live reader's snapshot, then ask the renderer to
    // redraw the current area. The Konva stage stays alive across all updates.
    useEffect(() => {
        const unsub = manager.mapStore.subscribe(() => {
            try { syncFromStore(); }
            catch (e) {
                setErrorMsg(e instanceof Error ? e.message : String(e));
                setStatus('error');
            }
        });
        return unsub;
    }, [manager, syncFromStore]);

    // Lua loadMap() routes through WindowManager → MapStore. The store's notify
    // will trigger the subscribe handler above; this callback only needs to
    // report whether the renderer reached a ready state.
    useEffect(() => {
        manager.registerMapLoadCallback(() => syncFromStore({
            keepArea: currentAreaRef.current ?? undefined,
            keepLevel: currentLevelRef.current,
        }));
        return () => manager.unregisterMapLoadCallback();
    }, [manager, syncFromStore]);

    // centerview: switch to the room's area/level, mark player position, and center.
    // The callback is stored in a ref so it always captures the latest renderer state.
    const centerViewImplRef = useRef<(roomId: number) => void>(() => {});
    centerViewImplRef.current = useCallback((roomId: number) => {
        const renderer = rendererRef.current;
        const reader = readerRef.current;
        if (!renderer || !reader) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let room: any;
        try { room = reader.getRoom(roomId); } catch { return; }
        const areaId: number = room.area;
        const zLevel: number = room.z;
        const areaLevels = reader.getArea(areaId).getZLevels().sort((a, b) => a - b);
        setLevels(areaLevels);
        setCurrentLevel(zLevel);
        setCurrentArea(areaId);
        setDropdownOpen(false);
        renderer.drawArea(areaId, zLevel);
        renderer.setPosition(roomId, true);
    }, []);

    useEffect(() => {
        const handler = (roomId: number) => centerViewImplRef.current(roomId);
        manager.registerMapCallback(id, handler);
        return () => manager.unregisterMapCallback(id);
    }, [id, manager]);

    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setStatus('loading');
        try {
            const buf = await file.arrayBuffer();
            // Routes through WindowManager: persists to IndexedDB, parses into
            // MapStore, raises sysMapLoadEvent, and the store's notify drives
            // the panel back to status='ready' via the subscribe handler.
            if (!manager.loadMap(buf)) {
                setErrorMsg('Failed to parse map file');
                setStatus('error');
            }
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
            setStatus('error');
        }
    }, [manager]);

    const selectArea = useCallback((id: number) => {
        const areaLevels = readerRef.current?.getArea(id).getZLevels().sort((a, b) => a - b) ?? [0];
        const level = areaLevels.includes(0) ? 0 : (areaLevels[0] ?? 0);
        setLevels(areaLevels);
        setCurrentLevel(level);
        setCurrentArea(id);
        setDropdownOpen(false);
        rendererRef.current?.drawArea(id, level);
        rendererRef.current?.fitArea();
    }, []);

    const handleLevelChange = useCallback((delta: number) => {
        if (!rendererRef.current || !currentArea) return;
        const idx = levels.indexOf(currentLevel);
        const nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx >= levels.length) return;
        const nextLevel = levels[nextIdx];
        setCurrentLevel(nextLevel);
        rendererRef.current.drawArea(currentArea, nextLevel);
    }, [currentArea, currentLevel, levels]);

    const currentAreaName = areas.find(a => a.id === currentArea)?.name ?? '';

    return (
        <div className="map-panel">
            <div ref={containerRef} className="map-canvas-container" />
            <input ref={fileInputRef} type="file" accept=".dat" onChange={handleFileChange} hidden />
            <div className="map-panel-toolbar">
                {status === 'ready' && areas.length > 1 && (
                    <div className="map-area-dropdown" ref={dropdownRef}>
                        <button
                            className="map-area-dropdown-btn"
                            onClick={() => setDropdownOpen(v => !v)}
                        >
                            <span className="map-area-dropdown-label">{currentAreaName}</span>
                            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
                                <path d="M0 0l4 5 4-5z" fill="currentColor" />
                            </svg>
                        </button>
                        {dropdownOpen && (
                            <div className="map-area-dropdown-list">
                                {areas.map(a => (
                                    <div
                                        key={a.id}
                                        className={`map-area-dropdown-item${a.id === currentArea ? ' map-area-dropdown-item--active' : ''}`}
                                        onMouseDown={() => selectArea(a.id)}
                                    >
                                        {a.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {status === 'ready' && levels.length > 1 && (
                    <div className="map-level-controls">
                        <button
                            className="btn btn--secondary btn--sm"
                            onClick={() => handleLevelChange(1)}
                            disabled={levels.indexOf(currentLevel) >= levels.length - 1}
                            title="Level up"
                        >▲</button>
                        <span className="map-level-display">{currentLevel}</span>
                        <button
                            className="btn btn--secondary btn--sm"
                            onClick={() => handleLevelChange(-1)}
                            disabled={levels.indexOf(currentLevel) <= 0}
                            title="Level down"
                        >▼</button>
                    </div>
                )}
                <div className="map-hamburger" ref={menuRef}>
                    <button
                        className="map-hamburger-btn"
                        onClick={() => setMenuOpen(v => !v)}
                        title="Map options"
                    >
                        <span /><span /><span />
                    </button>
                    {menuOpen && (
                        <div className="map-hamburger-menu">
                            <button
                                className="map-hamburger-item"
                                onMouseDown={() => { setMenuOpen(false); fileInputRef.current?.click(); }}
                            >
                                Load map…
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {status === 'loading' && (
                <div className="map-overlay">
                    <span>Loading map…</span>
                </div>
            )}
            {status === 'empty' && (
                <div className="map-overlay">
                    <label className="map-load-btn">
                        Load Mudlet Map
                        <input type="file" accept=".dat" onChange={handleFileChange} hidden />
                    </label>
                    <span className="map-overlay-hint">…or run your mapper script to add rooms</span>
                </div>
            )}
            {status === 'error' && (
                <div className="map-overlay map-overlay-error">
                    <span>Failed to load map: {errorMsg}</span>
                    <label className="map-load-btn">
                        Try another file
                        <input type="file" accept=".dat" onChange={handleFileChange} hidden />
                    </label>
                </div>
            )}
            {contextMenu && (
                <MapContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    roomId={contextMenu.roomId}
                    items={contextMenu.items}
                    onClose={() => setContextMenu(null)}
                    onSelect={(uniqueName) => {
                        manager.mapStore.dispatchMapEvent(uniqueName, contextMenu.roomId);
                        setContextMenu(null);
                    }}
                />
            )}
        </div>
    );
}

// Right-click menu for the map. Items with `parent` referencing another item's
// uniqueName nest as submenus that open on hover. Clicking a leaf dispatches
// the registered Lua event via mapStore.dispatchMapEvent.
interface MapContextMenuProps {
    x: number;
    y: number;
    roomId: number;
    items: MapEventEntry[];
    onSelect: (uniqueName: string) => void;
    onClose: () => void;
}

function MapContextMenu({ x, y, items, onSelect }: MapContextMenuProps) {
    const childrenByParent = new Map<string | null, MapEventEntry[]>();
    for (const item of items) {
        const key = item.parent ?? null;
        const arr = childrenByParent.get(key) ?? [];
        arr.push(item);
        childrenByParent.set(key, arr);
    }
    const topLevel = childrenByParent.get(null) ?? [];
    if (topLevel.length === 0) return null;

    return (
        <div
            id="mudix-map-context-menu"
            className="map-context-menu"
            style={{ left: x, top: y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {topLevel.map(item => (
                <MapContextMenuItem
                    key={item.uniqueName}
                    item={item}
                    childrenByParent={childrenByParent}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}

interface MapContextMenuItemProps {
    item: MapEventEntry;
    childrenByParent: Map<string | null, MapEventEntry[]>;
    onSelect: (uniqueName: string) => void;
}

function MapContextMenuItem({ item, childrenByParent, onSelect }: MapContextMenuItemProps) {
    const [submenuOpen, setSubmenuOpen] = useState(false);
    const children = childrenByParent.get(item.uniqueName) ?? [];
    const hasChildren = children.length > 0;

    return (
        <div
            className="map-context-menu-item"
            onMouseEnter={() => hasChildren && setSubmenuOpen(true)}
            onMouseLeave={() => hasChildren && setSubmenuOpen(false)}
            onMouseDown={(e) => {
                e.stopPropagation();
                onSelect(item.uniqueName);
            }}
        >
            <span className="map-context-menu-label">{item.displayName}</span>
            {hasChildren && <span className="map-context-menu-arrow">▶</span>}
            {hasChildren && submenuOpen && (
                <div className="map-context-menu map-context-menu--submenu">
                    {children.map(child => (
                        <MapContextMenuItem
                            key={child.uniqueName}
                            item={child}
                            childrenByParent={childrenByParent}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
