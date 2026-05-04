import { useCallback, useEffect, useRef, useState } from 'react';
import { MapReader, MapRenderer, createSettings } from 'mudlet-map-renderer';
import { readMapFromBuffer, readerExport } from 'mudlet-map-binary-reader';
import { Buffer } from 'buffer';
import { saveMap, loadMap } from '../../../storage/mapStorage';

type MapStatus = 'loading' | 'empty' | 'ready' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArea = any;

export function MapPanel() {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<MapRenderer | null>(null);
    const readerRef = useRef<MapReader | null>(null);
    const prevWidthRef = useRef<number>(0);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<MapStatus>('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [areas, setAreas] = useState<Array<{ id: number; name: string }>>([]);
    const [currentArea, setCurrentArea] = useState<number | null>(null);
    const [levels, setLevels] = useState<number[]>([]);
    const [currentLevel, setCurrentLevel] = useState<number>(0);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const initRenderer = useCallback((mapData: AnyArea[], colors: { envId: number; colors: number[] }[]) => {
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

        if (areaList.length > 0) {
            const firstId = areaList[0].id;
            const firstLevels = reader.getArea(firstId).getZLevels().sort((a, b) => a - b);
            const firstLevel = firstLevels.includes(0) ? 0 : (firstLevels[0] ?? 0);
            setLevels(firstLevels);
            setCurrentLevel(firstLevel);
            renderer.drawArea(firstId, firstLevel);
            renderer.fitArea();
            setCurrentArea(firstId);
        }

        setStatus('ready');
    }, []);

    const loadFromBuffer = useCallback(async (buf: ArrayBuffer) => {
        try {
            const mudletMap = readMapFromBuffer(Buffer.from(buf));
            const { mapData, colors } = readerExport(mudletMap);
            initRenderer(mapData as AnyArea[], colors);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : String(e));
            setStatus('error');
        }
    }, [initRenderer]);

    // Load from IndexedDB on mount
    useEffect(() => {
        loadMap().then(buf => {
            if (buf) {
                loadFromBuffer(buf);
            } else {
                setStatus('empty');
            }
        }).catch(() => setStatus('empty'));
    }, [loadFromBuffer]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!dropdownOpen) return;
        const onDown = (e: MouseEvent) => {
            if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [dropdownOpen]);

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

    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setStatus('loading');
        try {
            const buf = await file.arrayBuffer();
            await saveMap(buf);
            await loadFromBuffer(buf);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : String(err));
            setStatus('error');
        }
    }, [loadFromBuffer]);

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
            {status === 'ready' && (
                <div className="map-panel-toolbar">
                    {areas.length > 1 && (
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
                    {levels.length > 1 && (
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
                </div>
            )}
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
        </div>
    );
}
