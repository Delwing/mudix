import type { MudletRoom, MudletArea, MudletMap, MudletFont, MudletColor } from 'mudlet-map-binary-reader';
import { readerExport } from 'mudlet-map-binary-reader';

export type MapRendererData = ReturnType<typeof readerExport>;

// Mudlet direction number → field name on MudletRoom
const DIR_FIELD: Record<number, string> = {
    1: 'north', 2: 'northeast', 3: 'northwest', 4: 'east', 5: 'west',
    6: 'south', 7: 'southeast', 8: 'southwest', 9: 'up', 10: 'down',
    11: 'in', 12: 'out',
};

const DEFAULT_FONT: MudletFont = {
    family: 'Bitstream Vera Sans Mono', style: 'Normal',
    pointSize: 8, pixelSize: -1, styleHint: 5, styleStrategy: 1,
    weight: 50, fontBits: 0, stretch: 100, extendedFontBits: 0,
    letterSpacing: 0, wordSpacing: 0, hintingPreference: 0, capital: 0,
    styleSetting: false, underline: false, overline: false, strikeOut: false,
    fixedPitch: false, kerning: true, styleOblique: false,
    ignorePitch: false, letterSpacingIsAbsolute: false,
};

function makeRoom(areaId: number): MudletRoom {
    return {
        area: areaId, x: 0, y: 0, z: 0,
        north: -1, northeast: -1, northwest: -1, east: -1, west: -1,
        south: -1, southeast: -1, southwest: -1, up: -1, down: -1,
        in: -1, out: -1,
        environment: 0, weight: 1, name: '', isLocked: false,
        mSpecialExits: {}, mSpecialExitLocks: [],
        symbol: '', userData: {},
        customLines: {}, customLinesArrow: {}, customLinesColor: {}, customLinesStyle: {},
        exitLocks: [], stubs: [], exitWeights: {}, doors: {},
    };
}

function makeArea(): MudletArea {
    return {
        rooms: [], zLevels: [], mAreaExits: {}, gridMode: false,
        max_x: 0, max_y: 0, max_z: 0, min_x: 0, min_y: 0, min_z: 0,
        span: [0, 0, 0], xmaxForZ: {}, ymaxForZ: {}, xminForZ: {}, yminForZ: {},
        pos: [0, 0, 0], isZone: false, zoneAreaRef: 0, userData: {},
    };
}

export interface MapEventEntry {
    /** Stable id used by removeMapEvent and as a parent reference. */
    uniqueName: string;
    /** Event name passed to raiseEvent on click. */
    eventName: string;
    /** uniqueName of a parent entry that this is nested under, or null for top-level. */
    parent: string | null;
    /** Label rendered in the context menu. Defaults to uniqueName when unspecified. */
    displayName: string;
    /** Extra arguments passed to raiseEvent after the right-clicked roomId. */
    args: unknown[];
}

export class MapStore {
    private rooms = new Map<number, MudletRoom>();
    private areas = new Map<number, MudletArea>();
    private areaNames = new Map<number, string>();
    private hashToRoom = new Map<string, number>();
    private nextRoomId = 1;
    private nextAreaId = 1;
    private subscribers = new Set<() => void>();
    private notifyPending = false;
    private mapEvents = new Map<string, MapEventEntry>();
    private customEnvColors = new Map<number, MudletColor>();
    // Set by LuaRuntime so dispatchMapEvent can fire raiseEvent into the runtime.
    // Cleared on runtime teardown to avoid firing into a closed lua_State.
    private mapEventDispatcher: ((eventName: string, args: unknown[]) => void) | null = null;

    subscribe(cb: () => void): () => void {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
    }

    private notify(): void {
        if (this.notifyPending) return;
        this.notifyPending = true;
        queueMicrotask(() => {
            this.notifyPending = false;
            for (const cb of this.subscribers) cb();
        });
    }

    isEmpty(): boolean { return this.rooms.size === 0; }

    private initialized = false;

    /** True once newEmptyMap() has been called — the store is ready for scripting even with 0 rooms. */
    isInitialized(): boolean { return this.initialized; }

    /** Initialize with a single default area so scripts can start adding rooms immediately. */
    newEmptyMap(): void {
        this.rooms.clear();
        this.areas.clear();
        this.areaNames.clear();
        this.hashToRoom.clear();
        this.nextRoomId = 1;
        this.nextAreaId = 2;        // -1 is reserved below
        const defaultArea = makeArea();
        defaultArea.zLevels = [0];
        this.areas.set(-1, defaultArea);
        this.areaNames.set(-1, 'Default Area');
        this.initialized = true;
        this.notify();
    }

    toRendererData(): MapRendererData | null {
        if (this.rooms.size === 0) return null;
        try { return readerExport(this.toMudletMap()); } catch { return null; }
    }

    private toMudletMap(): MudletMap {
        const areas: Record<number, MudletArea> = {};
        for (const [id, a] of this.areas) areas[id] = a;
        const rooms: Record<number, MudletRoom> = {};
        for (const [id, r] of this.rooms) rooms[id] = r;
        const areaNames: Record<number, string> = {};
        for (const [id, n] of this.areaNames) areaNames[id] = n;
        const hashes: Record<string, number> = {};
        for (const [h, id] of this.hashToRoom) hashes[h] = id;
        const mCustomEnvColors: Record<number, MudletColor> = {};
        for (const [id, c] of this.customEnvColors) mCustomEnvColors[id] = c;
        return {
            version: 1, envColors: {}, areaNames, mCustomEnvColors,
            mpRoomDbHashToRoomId: hashes, mUserData: {},
            mapSymbolFont: DEFAULT_FONT, mapFontFudgeFactor: 1, useOnlyMapFont: false,
            areas, mRoomIdHash: {}, labels: {}, rooms,
        };
    }

    // ── Room IDs ──────────────────────────────────────────────────────────────

    createRoomID(): number {
        let id = this.nextRoomId;
        while (this.rooms.has(id)) id++;
        this.nextRoomId = id + 1;
        return id;
    }

    // ── Room CRUD ─────────────────────────────────────────────────────────────

    addRoom(id: number): boolean {
        if (this.rooms.has(id)) return false;
        this.rooms.set(id, makeRoom(0));
        this.notify();
        return true;
    }

    deleteRoom(id: number): void {
        const room = this.rooms.get(id);
        if (!room) return;
        const area = this.areas.get(room.area);
        if (area) {
            area.rooms = area.rooms.filter(r => r !== id);
            this.updateAreaBounds(room.area);
        }
        if (room.hash) this.hashToRoom.delete(room.hash);
        this.rooms.delete(id);
        this.notify();
    }

    roomExists(id: number): boolean { return this.rooms.has(id); }

    // ── Room properties ───────────────────────────────────────────────────────

    getRoomName(id: number): string | undefined { return this.rooms.get(id)?.name; }

    setRoomName(id: number, name: string): void {
        const r = this.rooms.get(id);
        if (r) { r.name = name; this.notify(); }
    }

    getRoomArea(id: number): number | undefined { return this.rooms.get(id)?.area; }

    setRoomArea(id: number, areaId: number): void {
        const room = this.rooms.get(id);
        if (!room) return;
        const oldArea = this.areas.get(room.area);
        if (oldArea) {
            oldArea.rooms = oldArea.rooms.filter(r => r !== id);
            this.updateAreaBounds(room.area);
        }
        if (!this.areas.has(areaId)) {
            this.areas.set(areaId, makeArea());
            if (!this.areaNames.has(areaId)) this.areaNames.set(areaId, `Area ${areaId}`);
            if (areaId >= this.nextAreaId) this.nextAreaId = areaId + 1;
        }
        this.areas.get(areaId)!.rooms.push(id);
        room.area = areaId;
        this.updateAreaBounds(areaId);
        this.notify();
    }

    getRoomCoordinates(id: number): [number, number, number] | undefined {
        const r = this.rooms.get(id);
        return r ? [r.x, r.y, r.z] : undefined;
    }

    setRoomCoordinates(id: number, x: number, y: number, z: number): void {
        const room = this.rooms.get(id);
        if (!room) return;
        room.x = x; room.y = y; room.z = z;
        this.updateAreaBounds(room.area);
        const area = this.areas.get(room.area);
        if (area && !area.zLevels.includes(z)) {
            area.zLevels.push(z);
            area.zLevels.sort((a, b) => a - b);
        }
        this.notify();
    }

    getRoomEnv(id: number): number { return this.rooms.get(id)?.environment ?? 0; }

    setRoomEnv(id: number, env: number): void {
        const r = this.rooms.get(id);
        if (r) { r.environment = env; this.notify(); }
    }

    getRoomChar(id: number): string { return this.rooms.get(id)?.symbol ?? ''; }

    setRoomChar(id: number, char: string): void {
        const r = this.rooms.get(id);
        if (r) { r.symbol = char; this.notify(); }
    }

    // ── Coordinates / position ────────────────────────────────────────────────

    getRoomsByPosition(areaId: number, x: number, y: number, z: number): number[] {
        const area = this.areas.get(areaId);
        if (!area) return [];
        return area.rooms.filter(id => {
            const r = this.rooms.get(id);
            return r && r.x === x && r.y === y && r.z === z;
        });
    }

    // ── Hash management ───────────────────────────────────────────────────────

    getRoomIDbyHash(hash: string): number | undefined { return this.hashToRoom.get(hash); }

    setRoomIDbyHash(id: number, hash: string): void {
        const room = this.rooms.get(id);
        if (!room) return;
        if (room.hash) this.hashToRoom.delete(room.hash);
        room.hash = hash;
        this.hashToRoom.set(hash, id);
        this.notify();
    }

    getRoomHashByID(id: number): string | undefined { return this.rooms.get(id)?.hash; }

    // ── Exits ─────────────────────────────────────────────────────────────────

    getRoomExits(id: number): Record<string, number> {
        const room = this.rooms.get(id);
        if (!room) return {};
        const exits: Record<string, number> = {};
        for (const field of Object.values(DIR_FIELD)) {
            const val = (room as unknown as Record<string, number>)[field];
            if (val !== -1) exits[field] = val;
        }
        return exits;
    }

    setExit(from: number, to: number, dir: number): void {
        const room = this.rooms.get(from);
        if (!room) return;
        const field = DIR_FIELD[dir];
        if (!field) return;
        (room as unknown as Record<string, number>)[field] = to;
        if (to >= 0) room.stubs = room.stubs.filter(s => s !== dir);
        this.notify();
    }

    getExitStubs(id: number): number[] { return [...(this.rooms.get(id)?.stubs ?? [])]; }

    setExitStub(id: number, dir: number, set: boolean): void {
        const room = this.rooms.get(id);
        if (!room) return;
        if (set) { if (!room.stubs.includes(dir)) room.stubs.push(dir); }
        else room.stubs = room.stubs.filter(s => s !== dir);
        this.notify();
    }

    addSpecialExit(from: number, to: number, cmd: string): void {
        const r = this.rooms.get(from);
        if (r) { r.mSpecialExits[cmd] = to; this.notify(); }
    }

    removeSpecialExit(from: number, cmd: string): void {
        const r = this.rooms.get(from);
        if (r) { delete r.mSpecialExits[cmd]; this.notify(); }
    }

    getSpecialExitsSwap(id: number): Record<string, number> {
        return { ...(this.rooms.get(id)?.mSpecialExits ?? {}) };
    }

    // ── Doors ─────────────────────────────────────────────────────────────────

    getDoors(id: number): Record<string, number> {
        return { ...(this.rooms.get(id)?.doors ?? {}) };
    }

    setDoor(id: number, dir: string, val: number): void {
        const room = this.rooms.get(id);
        if (!room) return;
        if (val <= 0) delete room.doors[dir];
        else room.doors[dir] = val;
        this.notify();
    }

    // ── User data ─────────────────────────────────────────────────────────────

    getRoomUserData(id: number, key: string): string {
        return this.rooms.get(id)?.userData[key] ?? '';
    }

    setRoomUserData(id: number, key: string, value: string): void {
        const r = this.rooms.get(id);
        if (r) { r.userData[key] = value; this.notify(); }
    }

    // ── Areas ─────────────────────────────────────────────────────────────────

    addAreaName(name: string): number {
        for (const [id, n] of this.areaNames) if (n === name) return id;
        const id = this.nextAreaId++;
        this.areas.set(id, makeArea());
        this.areaNames.set(id, name);
        this.notify();
        return id;
    }

    deleteArea(id: number): void {
        const area = this.areas.get(id);
        if (!area) return;
        for (const roomId of area.rooms) {
            const r = this.rooms.get(roomId);
            if (r?.hash) this.hashToRoom.delete(r.hash);
            this.rooms.delete(roomId);
        }
        this.areas.delete(id);
        this.areaNames.delete(id);
        this.notify();
    }

    getAreaTable(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const [id, name] of this.areaNames) out[name] = id;
        return out;
    }

    getRoomAreaName(areaId: number): string | undefined { return this.areaNames.get(areaId); }

    setAreaName(areaId: number, name: string): void {
        if (this.areaNames.has(areaId)) { this.areaNames.set(areaId, name); this.notify(); }
    }

    getAreaRooms(areaId: number): number[] {
        return [...(this.areas.get(areaId)?.rooms ?? [])];
    }

    getRooms(): Record<number, string> {
        const out: Record<number, string> = {};
        for (const [id, r] of this.rooms) out[id] = r.name;
        return out;
    }

    // ── Map context-menu events (Mudlet addMapEvent) ──────────────────────────

    setMapEventDispatcher(fn: ((eventName: string, args: unknown[]) => void) | null): void {
        this.mapEventDispatcher = fn;
    }

    addMapEvent(
        uniqueName: string,
        eventName: string,
        parent: string | null = null,
        displayName: string | null = null,
        ...args: unknown[]
    ): boolean {
        if (!uniqueName || !eventName) return false;
        this.mapEvents.set(uniqueName, {
            uniqueName,
            eventName,
            parent: parent && parent.length > 0 ? parent : null,
            displayName: displayName && displayName.length > 0 ? displayName : uniqueName,
            args,
        });
        return true;
    }

    removeMapEvent(uniqueName: string): boolean {
        return this.mapEvents.delete(uniqueName);
    }

    getMapEvents(): MapEventEntry[] {
        return [...this.mapEvents.values()];
    }

    /** Fire the registered event for a context-menu entry. The right-clicked
     *  roomId is prepended to the entry's stored args before raising. */
    dispatchMapEvent(uniqueName: string, roomId: number): void {
        const entry = this.mapEvents.get(uniqueName);
        if (!entry) return;
        this.mapEventDispatcher?.(entry.eventName, [roomId, ...entry.args]);
    }

    // ── Custom env colors (Mudlet setCustomEnvColor) ──────────────────────────

    /** Mudlet setCustomEnvColor(envID, r, g, b, a). envID identifies the user
     *  environment used by setRoomEnv; the renderer reads mCustomEnvColors and
     *  paints rooms with that env using these RGB values. spec=1 (RGB) is the
     *  Qt QColor::Rgb spec, matching what the binary reader emits. */
    setCustomEnvColor(envId: number, r: number, g: number, b: number, a = 255): void {
        this.customEnvColors.set(envId, { spec: 1, alpha: a, r, g, b });
        this.notify();
    }

    getCustomEnvColor(envId: number): { r: number; g: number; b: number; a: number } | undefined {
        const c = this.customEnvColors.get(envId);
        return c ? { r: c.r, g: c.g, b: c.b, a: c.alpha } : undefined;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private updateAreaBounds(areaId: number): void {
        const area = this.areas.get(areaId);
        if (!area || area.rooms.length === 0) return;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const id of area.rooms) {
            const r = this.rooms.get(id);
            if (!r) continue;
            if (r.x < minX) minX = r.x; if (r.x > maxX) maxX = r.x;
            if (r.y < minY) minY = r.y; if (r.y > maxY) maxY = r.y;
            if (r.z < minZ) minZ = r.z; if (r.z > maxZ) maxZ = r.z;
        }
        area.min_x = minX === Infinity ? 0 : minX;
        area.min_y = minY === Infinity ? 0 : minY;
        area.min_z = minZ === Infinity ? 0 : minZ;
        area.max_x = maxX === -Infinity ? 0 : maxX;
        area.max_y = maxY === -Infinity ? 0 : maxY;
        area.max_z = maxZ === -Infinity ? 0 : maxZ;
    }
}
