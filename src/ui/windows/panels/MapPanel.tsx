import { useCallback, useEffect, useRef, useState } from 'react';
import { MapRenderer, createSettings } from 'mudlet-map-renderer';
import type { RoomContextMenuEventDetail, RoomLens, Settings as MapRendererSettings } from 'mudlet-map-renderer';
import type { WindowManager, MapControl } from '../WindowManager';
import type { MapEventEntry, MapInfoResult } from '../../../map/MapStore';
import { MudixMapReader } from '../../../map/MudixMapReader';
import { MudletHighlightOverlay } from '../../../map/MudletHighlightOverlay';
import { useAppStore, selectProfileField, type MapperSettings } from '../../../storage';

/**
 * Copy user-set fields from MapperSettings onto a live renderer settings
 * object. Anything left undefined in `mapper` is intentionally not touched
 * so the renderer's own createSettings() defaults stay in effect.
 */
function applyMapperSettings(target: MapRendererSettings, mapper: MapperSettings | undefined): void {
    if (!mapper) return;
    if (mapper.roomSize !== undefined) target.roomSize = mapper.roomSize;
    if (mapper.roomShape !== undefined) target.roomShape = mapper.roomShape;
    if (mapper.borders !== undefined) target.borders = mapper.borders;
    if (mapper.lineWidth !== undefined) target.lineWidth = mapper.lineWidth;
    if (mapper.backgroundColor !== undefined) target.backgroundColor = mapper.backgroundColor;
    if (mapper.lineColor !== undefined) target.lineColor = mapper.lineColor;
    if (mapper.gridEnabled !== undefined) target.gridEnabled = mapper.gridEnabled;
}

type MapStatus = 'loading' | 'empty' | 'ready' | 'error';

/** Mudlet's hard floor for the 2D map zoom (T2DMap csmMinXYZoom): the shorter
 *  viewport edge may never span fewer than this many map units, i.e. you can't
 *  zoom in any closer. Mirrored here so wheel/pinch zoom obeys the same limit. */
const MUDLET_MIN_MAP_ZOOM = 3;

interface MapPanelProps {
    id: string;
    manager: WindowManager;
    connectionId: string;
}

export function MapPanel({ id, manager, connectionId }: MapPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<MapRenderer | null>(null);
    const readerRef = useRef<MudixMapReader | null>(null);
    const highlightOverlayRef = useRef<MudletHighlightOverlay | null>(null);
    const prevWidthRef = useRef<number>(0);
    const needsFitRef = useRef<boolean>(false);
    // Tracks the MapStore.hiddenVersion last applied to the renderer so the
    // store-change subscription can force a renderer.refresh() when the only
    // thing that changed was the hidden-room set — syncFromStore's
    // sceneUnchanged guard would otherwise skip the redraw.
    const lastHiddenVersionRef = useRef<number>(0);
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
    const [mapInfos, setMapInfos] = useState<MapInfoResult[]>([]);

    // Refs mirror the latest area/level so callbacks captured at mount time
    // can see the current selection (state values would be stale captures).
    const currentAreaRef = useRef<number | null>(null);
    const currentLevelRef = useRef<number>(0);
    currentAreaRef.current = currentArea;
    currentLevelRef.current = currentLevel;

    // User-tunable renderer settings (Mapper tab). Subscribing here re-renders
    // the panel whenever a field changes; the reactive effect below copies the
    // values onto the live renderer.settings. The ref lets the renderer-init
    // effect read the current value without taking `mapper` as a dependency
    // (which would tear down the renderer on every Mapper-tab edit).
    const mapper = useAppStore(s => selectProfileField(s, connectionId, 'mapper'));
    const mapperRef = useRef(mapper);
    mapperRef.current = mapper;

    // Read a saved per-area view directly from the store. Always reads live so
    // a write done moments earlier (flushSave on area switch) is visible.
    const getSavedView = useCallback(
        (areaId: number) =>
            useAppStore.getState().connectionProfile[connectionId]?.mapViewStates?.[areaId],
        [connectionId],
    );

    // Persist the camera state for the current area straight to the store.
    // We don't debounce here: the persist-storage adapter already coalesces
    // rapid mutations into a single localStorage write (with a pagehide flush),
    // so an extra in-panel debounce only created a window in which a quick
    // pan-then-reload would drop the user's last view.
    const saveViewState = useCallback(() => {
        const renderer = rendererRef.current;
        const areaId = currentAreaRef.current;
        if (!renderer || areaId == null) return;
        const bounds = renderer.getViewportBounds();
        const store = useAppStore.getState();
        const existing = store.connectionProfile[connectionId]?.mapViewStates ?? {};
        store.patchConnectionProfile(connectionId, {
            mapViewStates: {
                ...existing,
                [areaId]: {
                    level: currentLevelRef.current,
                    zoom: renderer.getZoom(),
                    centerX: (bounds.minX + bounds.maxX) / 2,
                    centerY: (bounds.minY + bounds.maxY) / 2,
                },
            },
            mapLastAreaId: areaId,
        });
    }, [connectionId]);

    // The renderer's player marker isn't gated by area/z — its onPositionChanged
    // runs after every drawArea and re-draws the marker at the player room's
    // (x, y) on whatever canvas is currently displayed, so viewing a different
    // area shows the marker in the wrong place. Gate it here: refresh the
    // marker only when the displayed area+level contains the player room,
    // otherwise clear it. clearPosition wipes positionRoomId but the next
    // sync call (after a manual switch back, or a centerview) restores it.

    // Re-evaluate every enabled registerMapInfo contributor. Cheap when no
    // contributors are registered (most profiles); contributors are pure-Lua
    // and the dispatcher pcalls each so a broken one can't take the panel
    // down. roomId is the player's current room (mudix has no selection model
    // — Mudlet's selectionSize/displayedAreaId distinction only matters there).
    const recomputeMapInfos = useCallback(() => {
        const areaId = currentAreaRef.current;
        if (areaId == null) {
            setMapInfos(prev => (prev.length === 0 ? prev : []));
            return;
        }
        const playerRoomId = manager.mapStore.getPlayerRoom();
        const playerRoomArea = playerRoomId != null
            ? manager.mapStore.getRoomArea(playerRoomId)
            : areaId;
        const next = manager.mapStore.evaluateMapInfos(
            playerRoomId,
            0,
            playerRoomArea === -1 ? areaId : playerRoomArea,
            areaId,
        );
        // Avoid a state churn (and downstream re-render) when nothing changed.
        // Compare cheaply by text+style — contributor identity is implicit in
        // insertion order, which is stable.
        setMapInfos(prev => {
            if (prev.length !== next.length) return next;
            for (let i = 0; i < next.length; i++) {
                const a = prev[i], b = next[i];
                if (a.label !== b.label || a.text !== b.text
                    || a.isBold !== b.isBold || a.isItalic !== b.isItalic
                    || a.color?.r !== b.color?.r || a.color?.g !== b.color?.g || a.color?.b !== b.color?.b) {
                    return next;
                }
            }
            return prev;
        });
    }, [manager]);

    const syncPositionMarker = useCallback((areaId: number, level: number) => {
        const renderer = rendererRef.current;
        const reader = readerRef.current;
        if (!renderer || !reader) return;
        const playerRoomId = manager.mapStore.getPlayerRoom();
        if (playerRoomId == null) {
            renderer.clearPosition();
            return;
        }
        const room = reader.getRoom(playerRoomId);
        if (room && room.area === areaId && room.z === level) {
            renderer.updatePositionMarker(playerRoomId);
        } else {
            renderer.clearPosition();
        }
    }, [manager]);

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

        // On first sync, restore the area the user was last viewing (and
        // that area's saved view). Subsequent calls keep whatever area the
        // user is currently in. Explicit hints (centerview from script) win.
        const profile = useAppStore.getState().connectionProfile[connectionId];
        const lastAreaId = profile?.mapLastAreaId;
        const keepArea = opts?.keepArea
            ?? currentAreaRef.current
            ?? (needsFitRef.current ? undefined : lastAreaId);
        const restoredArea = keepArea != null && areaList.some(a => a.id === keepArea)
            ? keepArea
            : areaList[0].id;
        const areaLevels = reader.getArea(restoredArea).getZLevels().sort((a, b) => a - b);
        const savedForArea = needsFitRef.current ? undefined : getSavedView(restoredArea);
        const keepLevel = opts?.keepLevel
            ?? (currentAreaRef.current != null ? currentLevelRef.current : savedForArea?.level);
        const restoredLevel =
            keepLevel != null && areaLevels.includes(keepLevel) ? keepLevel
            : areaLevels.includes(0) ? 0 : (areaLevels[0] ?? 0);
        setLevels(areaLevels);
        setCurrentLevel(restoredLevel);
        setCurrentArea(restoredArea);
        // Update the mirrors synchronously too. The render-time `ref = state`
        // assignment hasn't happened yet (setState is queued), so anything
        // that runs before the next render — notably the ResizeObserver
        // re-apply branch that fires from a queued layout pass — would
        // otherwise see stale (often null) values and fall through to fitArea,
        // clobbering the view we just restored.
        currentAreaRef.current = restoredArea;
        currentLevelRef.current = restoredLevel;
        // drawArea → state.setArea unconditionally re-emits 'area', forcing a
        // full scene rebuild (createExits is ~280ms on the Arkadia map) even
        // when the displayed area is identical. At boot syncFromStore fires
        // from several triggers — the map-load subscribe handler, the
        // registerMapLoadCallback, and the deferred idle build — so without a
        // guard the same scene is built two or three times. Skip the rebuild
        // when area + level + the reader's area instance/version all match what
        // the renderer last drew, mirroring the guard MapState.setPosition
        // already applies (instance identity catches a MudixMapReader inner
        // rebuild; version catches an in-place markDirty).
        const targetArea = reader.getArea(restoredArea);
        const st = renderer.state;
        const sceneUnchanged =
            st.currentArea === restoredArea &&
            st.currentZIndex === restoredLevel &&
            st.currentAreaInstance === targetArea &&
            st.currentAreaVersion === targetArea.getVersion();
        if (!sceneUnchanged) {
            renderer.drawArea(restoredArea, restoredLevel);
        } else if (manager.mapStore.getHiddenVersion() !== lastHiddenVersionRef.current) {
            // Same area/level, but the lens's hidden-room snapshot moved —
            // force a rebuild so newly-hidden rooms drop out (and previously-
            // hidden ones reappear). renderer.refresh() re-reads the lens
            // version on the next scene build.
            renderer.refresh();
        }
        lastHiddenVersionRef.current = manager.mapStore.getHiddenVersion();
        syncPositionMarker(restoredArea, restoredLevel);
        recomputeMapInfos();
        // Only fit on the first successful render; afterwards preserve user pan/zoom.
        // If we have a saved zoom/center for this area, apply that instead.
        if (!needsFitRef.current) {
            needsFitRef.current = true;
            if (savedForArea && Number.isFinite(savedForArea.zoom)) {
                renderer.setZoom(savedForArea.zoom);
                renderer.camera.panToMapPoint(savedForArea.centerX, savedForArea.centerY);
            } else {
                renderer.fitArea();
            }
        }
        setStatus('ready');
        return true;
    }, [connectionId, getSavedView, syncPositionMarker, recomputeMapInfos]);

    // Construct the renderer + live reader exactly once. Subsequent store
    // mutations flow through `reader.refresh()` + `renderer.drawArea(...)` —
    // the Konva stage and event listeners stay alive across map reloads.
    useEffect(() => {
        if (!containerRef.current) return;
        const reader = new MudixMapReader(manager.mapStore);
        readerRef.current = reader;
        const settings = createSettings();
        settings.areaName = false;
        settings.highlightCurrentRoom = false;
        settings.instantMapMove = true;
        applyMapperSettings(settings, mapperRef.current);
        const renderer = new MapRenderer(reader, settings, containerRef.current);
        renderer.centerOnResize = false;
        rendererRef.current = renderer;

        // Hidden-room lens: Mudlet's setRoomHidden(roomID, true) makes a room
        // (and any exit landing on it) disappear from the viewing-mode map.
        // The MapStore side-table is the source of truth; the renderer asks
        // the lens on every scene build, and its getVersion() tracks the
        // store's hiddenVersion counter so the renderer's lens-output cache
        // is invalidated whenever the set actually changes. Editing mode
        // (Mudlet's edit overlay) shows hidden rooms — match that by skipping
        // the filter when mapMode is 'editing'.
        const hiddenLens: RoomLens = {
            isVisible: (room) => {
                if (manager.mapStore.getMapMode() === 'editing') return true;
                return !manager.mapStore.isRoomHidden(room.id);
            },
            // Default treatment for an exit with one hidden endpoint is "stub"
            // (a short stub leaving the visible side), which would leave dangling
            // stubs pointing at every hidden room. Mudlet's setRoomHidden makes
            // both the room AND its exits disappear, so return "hidden" instead
            // when either endpoint is hidden in viewing mode.
            getExitTreatment: (_exit, a, b) => {
                if (manager.mapStore.getMapMode() === 'editing') return 'full';
                const aHidden = manager.mapStore.isRoomHidden(a.id);
                const bHidden = manager.mapStore.isRoomHidden(b.id);
                if (aHidden || bHidden) return 'hidden';
                return 'full';
            },
            getVersion: () => manager.mapStore.getHiddenVersion(),
        };
        renderer.setLens(hiddenLens);
        lastHiddenVersionRef.current = manager.mapStore.getHiddenVersion();

        // Mudlet-style highlights (radial gradient with both colours + alphas).
        // The overlay self-subscribes to MapStore mutations and area-change
        // events via its SceneOverlayContext; the renderer disposes it via
        // renderer.destroy(). Engine-agnostic, so it also appears in exports.
        const highlightOverlay = new MudletHighlightOverlay(manager.mapStore, reader);
        renderer.addSceneOverlay('mudlet-highlights', highlightOverlay);
        highlightOverlayRef.current = highlightOverlay;

        renderer.backend.events.on('roomcontextmenu', (detail: RoomContextMenuEventDetail) => {
            const items = manager.mapStore.getMapEvents();
            const rect = containerRef.current?.getBoundingClientRect();
            setContextMenu({
                x: (rect?.left ?? 0) + detail.position.x,
                y: (rect?.top ?? 0) + detail.position.y,
                roomId: detail.roomId,
                items,
            });
        });

        // Mudlet `sysMapWindowMousePressEvent(button, x, y)` — fired on every
        // mouse press inside the map widget. Mudlet's button mapping mirrors
        // sysWindowMousePressEvent (1=left, 2=right, 3=middle).
        const mapContainer = containerRef.current;
        const onMapMouseDown = (e: MouseEvent) => {
            const rect = mapContainer?.getBoundingClientRect();
            const x = Math.round(e.clientX - (rect?.left ?? 0));
            const y = Math.round(e.clientY - (rect?.top ?? 0));
            const button = e.button === 0 ? 1 : e.button === 2 ? 2 : e.button === 1 ? 3 : 0;
            manager.onRaiseEvent?.('sysMapWindowMousePressEvent', [button, x, y]);
        };
        mapContainer?.addEventListener('mousedown', onMapMouseDown);

        // Persist zoom/pan back to the profile whenever the camera moves.
        // Skipped until syncFromStore has applied saved/initial state so the
        // initial fitArea / restored-zoom doesn't trample a still-loading save.
        const onCameraChange = () => { if (needsFitRef.current) saveViewState(); };
        renderer.camera.on('change', onCameraChange);

        // Enforce Mudlet's zoom-in ceiling: the shorter viewport edge may never
        // span fewer than MUDLET_MIN_MAP_ZOOM map units. The renderer's camera
        // only clamps a zoom-out floor (minZoom), so wheel/pinch could otherwise
        // zoom in indefinitely. Mudlet additionally does NOT pan the view on a
        // wheel tick that is fully clamped (T2DMap only shifts the center inside
        // its "zoom actually changed" branch), whereas the renderer's wheel
        // handler always pans toward the cursor first — so a naive zoom clamp
        // leaves the map drifting cursor-ward without zooming.
        //
        // To match Mudlet we snapshot the camera in a capture-phase wheel
        // listener (it runs before the renderer's bubble listener on the canvas
        // element), then, in the synchronous 'zoom' event, redo the zoom from
        // that snapshot clamped to the cap. zoomToPoint reproduces the
        // cursor-focal pan for the part of the delta that fits under the cap and
        // applies zero pan once already at the limit. All of this runs before
        // the backend's rAF repaint, so no drifted/over-zoomed frame is painted.
        const panelEl = containerRef.current.parentElement;
        let wheelSnap: { zoom: number; x: number; y: number; sx: number; sy: number } | null = null;
        const onWheelCapture = (e: WheelEvent) => {
            const cam = renderer.camera;
            const rect = containerRef.current?.getBoundingClientRect();
            wheelSnap = {
                zoom: cam.zoom,
                x: cam.position.x,
                y: cam.position.y,
                sx: e.clientX - (rect?.left ?? 0),
                sy: e.clientY - (rect?.top ?? 0),
            };
        };
        panelEl?.addEventListener('wheel', onWheelCapture, { capture: true, passive: true });

        const onZoom = () => {
            const cam = renderer.camera;
            const shorter = Math.min(cam.width, cam.height);
            if (shorter <= 0) { wheelSnap = null; return; }
            const curZoom = renderer.getZoom();
            const base = curZoom > 0 ? cam.getScale() / curZoom : 75;
            const maxRendererZoom = shorter / (base * MUDLET_MIN_MAP_ZOOM);
            if (curZoom <= maxRendererZoom) { wheelSnap = null; return; }
            if (wheelSnap) {
                // Rewind to the pre-tick transform, then redo the zoom clamped
                // to the cap about the cursor: this pans only for the part of
                // the requested delta that stays within the limit, and not at
                // all once the snapshot was already at the cap.
                cam.zoom = wheelSnap.zoom;
                cam.position = { x: wheelSnap.x, y: wheelSnap.y };
                if (!cam.zoomToPoint(maxRendererZoom, wheelSnap.sx, wheelSnap.sy)) {
                    // Already at the cap: zoom is unchanged so zoomToPoint did
                    // not repaint, but the renderer's pre-clamp wheel pan has
                    // already pushed the Konva stage off. Force a viewport
                    // re-apply from the restored (pre-tick) center so the stage
                    // doesn't keep rendering the drifted transform.
                    const b = cam.getViewportBounds();
                    cam.panToMapPoint((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
                }
                wheelSnap = null;
            } else {
                // Non-wheel path (touch pinch): clamp about the viewport center.
                renderer.zoomToCenter(maxRendererZoom);
            }
        };
        renderer.events.on('zoom', onZoom);

        return () => {
            renderer.events.off('zoom', onZoom);
            panelEl?.removeEventListener('wheel', onWheelCapture, { capture: true });
            mapContainer?.removeEventListener('mousedown', onMapMouseDown);
            renderer.camera.off('change', onCameraChange);
            renderer.destroy();
            rendererRef.current = null;
            readerRef.current = null;
            highlightOverlayRef.current = null;
        };
    }, [manager, saveViewState]);

    // Forward Mapper-tab edits onto the live renderer.settings. The settings
    // object is shared and mutable, but the renderer caches some derived
    // state per scene build, so size/shape/color changes only show up after
    // refresh(); backgroundColor lives on the container element and is
    // updated separately via updateBackground().
    useEffect(() => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        applyMapperSettings(renderer.settings, mapper);
        renderer.refresh();
        renderer.updateBackground();
    }, [mapper]);

    // Boot path: ScriptingEngine and this panel both call bootstrapMap; the
    // manager dedupes to a single IndexedDB fetch + parse. Once it resolves
    // (or fails) we sync from the now-populated MapStore.
    //
    // The first sync runs drawArea, whose createExits step is one of the
    // single biggest main-thread blocks during boot (~140ms+). We yield with
    // requestIdleCallback (fallback: rAF + setTimeout) so the browser paints
    // the rest of the UI first, then build the map scene — this keeps the
    // map's first-paint cost from delaying LCP.
    useEffect(() => {
        let cancelled = false;
        let idleHandle: ReturnType<typeof setTimeout> | number | null = null;
        setStatus('loading');
        const runSync = () => {
            if (cancelled) return;
            try { syncFromStore(); }
            catch (e) {
                setErrorMsg(e instanceof Error ? e.message : String(e));
                setStatus('error');
            }
        };
        const scheduleAfterPaint = (cb: () => void) => {
            const rIC = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
            if (typeof rIC === 'function') {
                idleHandle = rIC(cb, { timeout: 300 });
            } else {
                // Double-yield: rAF fires *before* the next paint, so chain a
                // task to land after the paint commits.
                requestAnimationFrame(() => { idleHandle = setTimeout(cb, 0); });
            }
        };
        manager.bootstrapMap().then(() => {
            if (cancelled) return;
            scheduleAfterPaint(runSync);
        });
        return () => {
            cancelled = true;
            const cIC = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
            if (idleHandle != null) {
                if (typeof cIC === 'function') cIC(idleHandle as number);
                else clearTimeout(idleHandle as ReturnType<typeof setTimeout>);
            }
        };
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
                    const areaId = currentAreaRef.current;
                    const saved = areaId != null ? getSavedView(areaId) : undefined;
                    if (saved && Number.isFinite(saved.zoom)) {
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
    }, [getSavedView]);

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
        // Crossing into another area — persist the new last-area pointer up
        // front so a reload before the new area's first camera-change save
        // still returns to it. centerview itself keeps the current zoom
        // (mapper-script semantics: follow the player without rescaling).
        const prevArea = currentAreaRef.current;
        if (prevArea !== areaId) {
            useAppStore.getState().patchConnectionProfile(connectionId, { mapLastAreaId: areaId });
            // Mudlet `sysMapAreaChanged(newAreaID, prevAreaID)`.
            manager.onRaiseEvent?.('sysMapAreaChanged', [areaId, prevArea ?? -1]);
        }
        setLevels(areaLevels);
        setCurrentLevel(zLevel);
        setCurrentArea(areaId);
        currentAreaRef.current = areaId;
        currentLevelRef.current = zLevel;
        setDropdownOpen(false);
        // setPosition() internally calls setArea() only when area/z (or the
        // area instance/version) actually change, then emits 'position'. On
        // same-area moves — the speedwalk path — this skips the 'area' event
        // and therefore the full refresh()/syncPaths/sceneOverlay rebuild
        // that drawArea would have forced. Cross-area moves still refresh.
        renderer.setPosition(roomId, true);
        recomputeMapInfos();
    }, [connectionId, manager, recomputeMapInfos]);

    useEffect(() => {
        const handler = (roomId: number) => centerViewImplRef.current(roomId);
        manager.registerMapCallback(id, handler);
        return () => manager.unregisterMapCallback(id);
    }, [id, manager]);

    // Lua getMapZoom/setMapZoom/updateMap reach the renderer through here. The
    // impl is held in a ref so the registered control always sees the latest
    // renderer/syncFromStore without re-registering on every render. setZoom
    // re-centers + repaints the same way the resize handler does (the renderer
    // repaints on a camera move, not on setZoom alone).
    //
    // Zoom is expressed in Mudlet units: the value is the number of map (room)
    // units visible across the *shorter* edge of the viewport — matching
    // Mudlet's T2DMap, where the shorter widget edge always spans exactly `zoom`
    // units (zoom=3 → 3 rooms across, zoom=100 → ~100; larger = more map = zoomed
    // out). The renderer instead works in pixels-per-room-unit
    // (camera.getScale() === BASE_SCALE * rendererZoom), so we convert at this
    // boundary: pxPerUnit = shorterEdge / mudletZoom.
    const mapControlImplRef = useRef<MapControl>({ getZoom: () => null, setZoom: () => {}, redraw: () => {} });
    mapControlImplRef.current = {
        getZoom: () => {
            const renderer = rendererRef.current;
            if (!renderer) return null;
            const cam = renderer.camera;
            const shorter = Math.min(cam.width, cam.height);
            const scale = cam.getScale(); // pixels per room unit
            if (shorter <= 0 || scale <= 0) return null;
            return shorter / scale;
        },
        setZoom: (zoom: number) => {
            const renderer = rendererRef.current;
            if (!renderer || !Number.isFinite(zoom) || zoom <= 0) return;
            const cam = renderer.camera;
            const shorter = Math.min(cam.width, cam.height);
            if (shorter <= 0) return;
            // Recover the renderer's pixels-per-unit-at-zoom-1 from the live
            // camera (getScale() === base * rendererZoom) rather than hardcoding
            // the library's BASE_SCALE constant, then solve for the rendererZoom
            // that makes `zoom` room units fill the shorter edge.
            const curZoom = renderer.getZoom();
            const base = curZoom > 0 ? cam.getScale() / curZoom : 75;
            const rendererZoom = shorter / (base * zoom);
            if (!Number.isFinite(rendererZoom) || rendererZoom <= 0) return;
            // fitArea pins camera.minZoom to the fit zoom, which would clamp a
            // zoom-out request; lower the floor so an explicit setMapZoom is
            // honored (and the user can wheel back out that far afterwards).
            if (rendererZoom < renderer.minZoom) renderer.minZoom = rendererZoom;
            const bounds = renderer.getViewportBounds();
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            renderer.setZoom(rendererZoom);
            renderer.camera.panToMapPoint(cx, cy);
        },
        redraw: () => {
            try { syncFromStore(); }
            catch (e) {
                setErrorMsg(e instanceof Error ? e.message : String(e));
                setStatus('error');
            }
        },
    };
    useEffect(() => {
        const ctrl: MapControl = {
            getZoom: () => mapControlImplRef.current.getZoom(),
            setZoom: (z) => mapControlImplRef.current.setZoom(z),
            redraw: () => mapControlImplRef.current.redraw(),
        };
        manager.registerMapControl(id, ctrl);
        return () => manager.unregisterMapControl(id);
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
        const renderer = rendererRef.current;
        if (!renderer) return;
        // Persist the new mapLastAreaId immediately so a tab close before the
        // new area's first camera-change save fires still restores to it.
        const prevArea = currentAreaRef.current;
        if (prevArea !== id) {
            useAppStore.getState().patchConnectionProfile(connectionId, { mapLastAreaId: id });
            // Mudlet `sysMapAreaChanged(newAreaID, prevAreaID)`.
            manager.onRaiseEvent?.('sysMapAreaChanged', [id, prevArea ?? -1]);
        }
        const areaLevels = readerRef.current?.getArea(id).getZLevels().sort((a, b) => a - b) ?? [0];
        const saved = getSavedView(id);
        const level = saved && areaLevels.includes(saved.level)
            ? saved.level
            : areaLevels.includes(0) ? 0 : (areaLevels[0] ?? 0);
        setLevels(areaLevels);
        setCurrentLevel(level);
        setCurrentArea(id);
        currentAreaRef.current = id;
        currentLevelRef.current = level;
        setDropdownOpen(false);
        renderer.drawArea(id, level);
        syncPositionMarker(id, level);
        if (saved && Number.isFinite(saved.zoom)) {
            renderer.setZoom(saved.zoom);
            renderer.camera.panToMapPoint(saved.centerX, saved.centerY);
        } else {
            renderer.fitArea();
        }
        recomputeMapInfos();
    }, [getSavedView, connectionId, manager, syncPositionMarker, recomputeMapInfos]);

    const handleLevelChange = useCallback((delta: number) => {
        if (!rendererRef.current || !currentArea) return;
        const idx = levels.indexOf(currentLevel);
        const nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx >= levels.length) return;
        const nextLevel = levels[nextIdx];
        setCurrentLevel(nextLevel);
        rendererRef.current.drawArea(currentArea, nextLevel);
        syncPositionMarker(currentArea, nextLevel);
        recomputeMapInfos();
    }, [currentArea, currentLevel, levels, syncPositionMarker, recomputeMapInfos]);

    const currentAreaName = areas.find(a => a.id === currentArea)?.name ?? '';

    return (
        <div className="map-panel">
            <div ref={containerRef} className="map-canvas-container" />
            {mapInfos.length > 0 && (
                <div className="map-info">
                    {mapInfos.map(info => (
                        <div
                            key={info.label}
                            className="map-info-entry"
                            style={{
                                fontWeight: info.isBold ? 700 : undefined,
                                fontStyle: info.isItalic ? 'italic' : undefined,
                                color: info.color ? `rgb(${info.color.r}, ${info.color.g}, ${info.color.b})` : undefined,
                            }}
                        >
                            {info.text}
                        </div>
                    ))}
                </div>
            )}
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
                    builtinItems={[
                        {
                            label: 'Set player location',
                            onClick: () => {
                                // Mudlet `sysManualLocationSetEvent(roomID)` —
                                // fires when the user pins the player room via
                                // the map's right-click action.
                                manager.onRaiseEvent?.('sysManualLocationSetEvent', [contextMenu.roomId]);
                                centerViewImplRef.current(contextMenu.roomId);
                                setContextMenu(null);
                            },
                        },
                    ]}
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
interface MapContextMenuBuiltin {
    label: string;
    onClick: () => void;
}

interface MapContextMenuProps {
    x: number;
    y: number;
    roomId: number;
    items: MapEventEntry[];
    /** Client-provided items rendered above user entries, separated by a divider. */
    builtinItems: MapContextMenuBuiltin[];
    onSelect: (uniqueName: string) => void;
    onClose: () => void;
}

function MapContextMenu({ x, y, items, builtinItems, onSelect }: MapContextMenuProps) {
    const childrenByParent = new Map<string | null, MapEventEntry[]>();
    for (const item of items) {
        const key = item.parent ?? null;
        const arr = childrenByParent.get(key) ?? [];
        arr.push(item);
        childrenByParent.set(key, arr);
    }
    const topLevel = childrenByParent.get(null) ?? [];
    if (topLevel.length === 0 && builtinItems.length === 0) return null;

    return (
        <div
            id="mudix-map-context-menu"
            className="map-context-menu"
            style={{ left: x, top: y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {builtinItems.map((builtin, i) => (
                <div
                    key={`builtin-${i}`}
                    className="map-context-menu-item"
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        builtin.onClick();
                    }}
                >
                    <span className="map-context-menu-label">{builtin.label}</span>
                </div>
            ))}
            {builtinItems.length > 0 && topLevel.length > 0 && (
                <div className="map-context-menu-separator" />
            )}
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
