import { useCallback, useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { MapReader, MapRenderer, createSettings } from 'mudlet-map-renderer';
import { readMapFromBuffer, readerExport } from 'mudlet-map-binary-reader';
import { Buffer } from 'buffer';
import { saveMap, loadMap } from '../../../storage/mapStorage';

type MapStatus = 'loading' | 'empty' | 'ready' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArea = any;

export function MapPanel(_props: IDockviewPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<MapRenderer | null>(null);
    const readerRef = useRef<MapReader | null>(null);
    const [status, setStatus] = useState<MapStatus>('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [areas, setAreas] = useState<Array<{ id: number; name: string }>>([]);
    const [currentArea, setCurrentArea] = useState<number | null>(null);

    const initRenderer = useCallback((mapData: AnyArea[], colors: { envId: number; colors: number[] }[]) => {
        if (!containerRef.current) return;
        rendererRef.current?.destroy();

        const reader = new MapReader(mapData, colors);
        readerRef.current = reader;

        const areaList = reader.getAreas().map(a => ({ id: a.getAreaId(), name: a.getAreaName() }));
        setAreas(areaList);

        const settings = createSettings();
        const renderer = new MapRenderer(reader, settings, containerRef.current);
        renderer.centerOnResize = true;
        rendererRef.current = renderer;

        if (areaList.length > 0) {
            const firstId = areaList[0].id;
            renderer.drawArea(firstId, 0);
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


    // Divs don't fire "resize" natively; the renderer needs it to update canvas size.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            el.dispatchEvent(new Event('resize'));
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

    const handleAreaChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = Number(e.target.value);
        setCurrentArea(id);
        rendererRef.current?.drawArea(id, 0);
        rendererRef.current?.fitArea();
    }, []);

    return (
        <div className="map-panel">
            {status === 'ready' && areas.length > 1 && (
                <div className="map-panel-toolbar">
                    <select
                        className="map-area-select"
                        value={currentArea ?? ''}
                        onChange={handleAreaChange}
                    >
                        {areas.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </select>
                </div>
            )}
            <div ref={containerRef} className="map-canvas-container" />
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
