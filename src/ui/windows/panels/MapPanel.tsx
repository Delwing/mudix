import { useCallback, useEffect, useRef, useState } from 'react';
import { MapReader, MapRenderer, createSettings } from 'mudlet-map-renderer';
import type { RoomContextMenuEventDetail } from 'mudlet-map-renderer';
import { readMapFromBuffer, readerExport } from 'mudlet-map-binary-reader';
import { Buffer } from 'buffer';
import { saveMap, loadMap } from '../../../storage/mapStorage';
import type { WindowManager } from '../WindowManager';
import type { MapEventEntry } from '../../../map/MapStore';

type MapStatus = 'loading' | 'empty' | 'ready' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArea = any;

interface MapPanelProps {
    id: string;
    manager: WindowManager;
    connectionId: string;
}

export function MapPanel({ id, manager, connectionId }: MapPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<MapRenderer | null>(null);
    const readerRef = useRef<MapReader | null>(null);
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
    const [storeInitialized, setStoreInitialized] = useState(() => manager.mapStore.isInitialized());
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        roomId: number;
        items: MapEventEntry[];
    } | null>(null);

    const initRenderer = useCallback((
        mapData: AnyArea[],
        colors: { envId: number; colors: number[] }[],
        keepAreaId?: number,
        keepLevel?: number,
    ) => {
        if (!containerRef.current) return;
        rendererRef.current?.destroy();

        const reader = new MapReader(mapData, colors);
        readerRef.current = reader;

        const areaList = reader.getAreas()
            .map(a => ({ id: a.getAreaId(), name: a.getAreaName() }))
            .sort((a, b) => a.name.localeCompare(b.name));
        setAreas(areaList);

        const settings = createSettings();
        settings.areaName = false;
        const renderer = new MapRenderer(reader, settings, containerRef.current);
        renderer.centerOnResize = false;
        rendererRef.current = renderer;

        renderer.backend.events.on('roomcontextmenu', (detail: RoomContextMenuEventDetail) => {
            const items = manager.mapStore.getMapEvents();
            if (items.length === 0) return;
            // Renderer emits container-relative coords; the menu uses position:fixed,
            // so add the container's viewport offset to land on the clicked room.
            const rect = containerRef.current?.getBoundingClientRect();
            setContextMenu({
                x: (rect?.left ?? 0) + detail.position.x,
                y: (rect?.top ?? 0) + detail.position.y,
                roomId: detail.roomId,
                items,
            });
        });

        if (areaList.length > 0) {
            // Restore previous area/level if still available, otherwise pick first.
            const restoredArea = keepAreaId != null && areaList.some(a => a.id === keepAreaId)
                ? keepAreaId
                : areaList[0].id;
            const areaLevels = reader.getArea(restoredArea).getZLevels().sort((a, b) => a - b);
            const restoredLevel =
                keepLevel != null && areaLevels.includes(keepLevel) ? keepLevel
                : areaLevels.includes(0) ? 0 : (areaLevels[0] ?? 0);
            setLevels(areaLevels);
            setCurrentLevel(restoredLevel);
            renderer.drawArea(restoredArea, restoredLevel);
            needsFitRef.current = true;
            renderer.fitArea();
            setCurrentArea(restoredArea);
        }

        setStatus('ready');
    }, [manager]);

    const loadFromBuffer = useCallback((buf: ArrayBuffer): boolean => {
        try {
            const mudletMap = readMapFromBuffer(Buffer.from(buf));
            const { mapData, colors } = readerExport(mudletMap);
            manager.setHashMap(mudletMap.mpRoomDbHashToRoomId ?? {});
            initRenderer(mapData as AnyArea[], colors);
            return true;
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : String(e));
            setStatus('error');
            return false;
        }
    }, [initRenderer, manager]);

    const reloadFromStorage = useCallback(() => {
        setStatus('loading');
        loadMap(connectionId).then(buf => {
            if (buf) {
                loadFromBuffer(buf);
            } else {
                setStatus('empty');
            }
        }).catch(() => setStatus('empty'));
    }, [connectionId, loadFromBuffer]);

    // Load from IndexedDB on mount
    useEffect(() => {
        reloadFromStorage();
    }, [reloadFromStorage]);

    // Wire up the scripting `loadMap()` entry point. With a buffer the parse
    // runs synchronously so Lua's `loadMap(path)` reflects parse failure; with
    // no buffer we re-fetch from IndexedDB asynchronously and return true.
    useEffect(() => {
        manager.registerMapLoadCallback((buf?: ArrayBuffer) => {
            if (buf) return loadFromBuffer(buf);
            reloadFromStorage();
            return true;
        });
        return () => manager.unregisterMapLoadCallback();
    }, [manager, loadFromBuffer, reloadFromStorage]);

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
                renderer.backend.viewport.panToMapPoint(cx, cy);
            } else {
                el.dispatchEvent(new Event('resize'));
                if (renderer && newWidth > 0 && needsFitRef.current) {
                    renderer.fitArea();
                    needsFitRef.current = false;
                }
            }
            prevWidthRef.current = newWidth;
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Cleanup renderer on unmount
    useEffect(() => {
        return () => { rendererRef.current?.destroy(); };
    }, []);

    // Subscribe to MapStore changes (scripting-built maps). Re-init renderer when
    // the store gains rooms, preserving the current area/level across updates.
    const currentAreaRef = useRef<number | null>(null);
    const currentLevelRef = useRef<number>(0);
    currentAreaRef.current = currentArea;
    currentLevelRef.current = currentLevel;
    useEffect(() => {
        const unsub = manager.mapStore.subscribe(() => {
            setStoreInitialized(manager.mapStore.isInitialized());
            const data = manager.mapStore.toRendererData();
            if (!data) return;
            initRenderer(
                data.mapData as AnyArea[],
                data.colors,
                currentAreaRef.current ?? undefined,
                currentLevelRef.current,
            );
        });
        // If MapStore already has rooms when we mount (e.g. re-opening the panel), render immediately.
        const data = manager.mapStore.toRendererData();
        if (data) {
            initRenderer(data.mapData as AnyArea[], data.colors);
        }
        return unsub;
    }, [manager, initRenderer]);

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
            await saveMap(connectionId, buf);
            loadFromBuffer(buf);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
            setStatus('error');
        }
    }, [connectionId, loadFromBuffer]);

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
                    {storeInitialized ? (
                        <span className="map-overlay-hint">Map initialized — run your mapper script to add rooms</span>
                    ) : (
                        <>
                            <label className="map-load-btn">
                                Load Mudlet Map
                                <input type="file" accept=".dat" onChange={handleFileChange} hidden />
                            </label>
                            <button
                                className="map-load-btn"
                                onClick={() => { manager.mapStore.newEmptyMap(); }}
                            >
                                New Empty Map
                            </button>
                        </>
                    )}
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
