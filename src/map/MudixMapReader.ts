import {MapReader} from 'mudlet-map-renderer';
import type {IArea, IMapReader} from 'mudlet-map-renderer';
import {readerExport} from 'mudlet-map-binary-reader';
import type {MudletLabel, MudletMap} from 'mudlet-map-binary-reader';
import {Buffer} from 'buffer';
import type {MapStore} from './MapStore';

// The renderer's `MapData.Room` / `MapData.Map` types live in a global
// namespace inside the package and aren't re-exported by name; derive the
// concrete shapes from `MapReader`'s public surface so mudix's tsc resolves
// them without needing the namespace.
type RoomShape = ReturnType<MapReader['getRoom']>;
type MapShape = ConstructorParameters<typeof MapReader>[0];

/**
 * Live {@link IMapReader} backed by Mudix's {@link MapStore}.
 *
 * The renderer is constructed once on panel mount and held for the lifetime of
 * the panel. Whenever the store mutates (script-built rooms, binary load,
 * setRoomCoordinates, …) the panel calls {@link refresh}; this rebuilds the
 * inner concrete {@link MapReader} from the store's current snapshot. The
 * renderer's `MapState` notices the new `IArea` instance via reference
 * inequality and rebuilds the scene — no Konva stage / event listener
 * teardown.
 *
 * The renderer's wire format (`{mapData, colors}`) is produced via
 * `readerExport(store.toMudletMap())` — the same transformation Mudlet's own
 * binary-reader pipeline applies. Doing it inside the reader (instead of in
 * the panel) keeps `MapPanel` pure-view: it never sees the wire format.
 */
export class MudixMapReader implements IMapReader {
    private inner: MapReader;
    private snapshotVersion = -1;

    constructor(private readonly store: MapStore) {
        this.inner = this.buildInner();
    }

    /** Rebuild the inner reader from MapStore's current snapshot. Safe to
     *  call from a store-change subscriber — cheap when the store is empty
     *  and idempotent when no mutation has happened since the last refresh. */
    refresh(): void {
        const storeVersion = this.store.getVersion();
        if (storeVersion === this.snapshotVersion) return;
        this.inner = this.buildInner();
        this.snapshotVersion = storeVersion;
    }

    /**
     * Stale-check before every public read. The renderer can ask for a room
     * synchronously after a script mutation (e.g. addRoom → centerview),
     * before MapStore's microtask-delayed notify fires. Running the version
     * check on every call is O(1); a real rebuild only happens when the
     * store has actually mutated since the last snapshot.
     */
    private ensureFresh(): void {
        if (this.store.getVersion() !== this.snapshotVersion) {
            this.refresh();
        }
    }

    /** True once the store has at least one room; the panel's empty-state
     *  overlay stays up until this flips. */
    hasData(): boolean {
        return !this.store.isEmpty();
    }

    private buildInner(): MapReader {
        const mudletMap = this.store.toMudletMap();
        if (Object.keys(mudletMap.rooms).length === 0) {
            return new MapReader([], []);
        }
        // readerExport internally does `lodash.cloneDeep(mapModel)`. On
        // label-heavy maps that walks each pixMap Buffer via cloneArrayBuffer
        // — hundreds of ms per image, paid on every store-version bump. The
        // worker / loadFromBinary normalize pixmaps to base64 strings up-front,
        // but readerExport's own convertLabel still re-runs `Buffer.from(...)`
        // on whatever it gets. Strip the pixmaps to a shared empty Buffer for
        // the clone, then patch the renderer-format output back with the
        // already-cached base64 strings.
        const emptyBuf = Buffer.alloc(0);
        const pixmapByArea = new Map<string, string[]>();
        const strippedLabels: Record<number, MudletLabel[]> = {};
        for (const [areaIdStr, labels] of Object.entries(mudletMap.labels ?? {})) {
            const cached: string[] = [];
            strippedLabels[Number(areaIdStr)] = labels.map(l => {
                cached.push(typeof l.pixMap === 'string' ? l.pixMap : '');
                return {...l, pixMap: emptyBuf};
            });
            pixmapByArea.set(areaIdStr, cached);
        }
        const stripped: MudletMap = {...mudletMap, labels: strippedLabels};
        const {mapData, colors} = readerExport(stripped);
        // mapData[].areaId is the same string key we indexed by; patch each
        // label's renderer-shape pixMap back to its real base64 payload.
        for (const area of mapData) {
            const cached = pixmapByArea.get(String(area.areaId));
            if (!cached) continue;
            for (let i = 0; i < area.labels.length; i++) {
                (area.labels[i] as {pixMap: string}).pixMap = cached[i] ?? '';
            }
        }
        // RendererRoom (binary-reader output) is structurally a MapData.Room
        // with `areaId` missing — the renderer reads room.area, not
        // room.areaId, so the gap is harmless. Cast through unknown to bridge.
        return new MapReader(mapData as unknown as MapShape, colors);
    }

    // --- IMapReader forwarding ------------------------------------------------

    getArea(areaId: number): IArea {
        this.ensureFresh();
        return this.inner.getArea(areaId);
    }

    getAreas(): IArea[] {
        this.ensureFresh();
        return this.inner.getAreas();
    }

    getRooms(): RoomShape[] {
        this.ensureFresh();
        return this.inner.getRooms();
    }

    getRoom(roomId: number): RoomShape {
        this.ensureFresh();
        return this.inner.getRoom(roomId);
    }

    getColorValue(envId: number): string {
        this.ensureFresh();
        return this.inner.getColorValue(envId);
    }

    getSymbolColor(envId: number, opacity?: number): string {
        this.ensureFresh();
        return this.inner.getSymbolColor(envId, opacity);
    }
}
