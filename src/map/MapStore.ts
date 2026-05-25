import type {MudletArea, MudletColor, MudletFont, MudletLabel, MudletMap, MudletRoom} from 'mudlet-map-binary-reader';
import {readerExport} from 'mudlet-map-binary-reader';
import {findPath, type PathfindResult} from './pathfinding';

export type {PathfindResult} from './pathfinding';

export type MapRendererData = ReturnType<typeof readerExport>;

// Mudlet direction number → field name on MudletRoom
const DIR_FIELD: Record<number, string> = {
    1: 'north', 2: 'northeast', 3: 'northwest', 4: 'east', 5: 'west',
    6: 'south', 7: 'southeast', 8: 'southwest', 9: 'up', 10: 'down',
    11: 'in', 12: 'out',
};

// Mudlet direction number → short name used to key per-exit weights. The binary
// reader stores stock-exit weights under these short names (see pathfinding.ts
// and mudlet-map-binary-reader's json-export), while special-exit weights are
// keyed by the verbatim command string.
const DIR_SHORT: Record<number, string> = {
    1: 'n', 2: 'ne', 3: 'nw', 4: 'e', 5: 'w',
    6: 's', 7: 'se', 8: 'sw', 9: 'up', 10: 'down',
    11: 'in', 12: 'out',
};

// Mudlet exit/door APIs accept either an integer 1-12 or a long/short
// direction name. Normalize either form to the canonical 1-12 index, or
// undefined when the value isn't a recognized direction.
const DIR_NAME_TO_INT: Record<string, number> = {
    n: 1, north: 1,
    ne: 2, northeast: 2,
    nw: 3, northwest: 3,
    e: 4, east: 4,
    w: 5, west: 5,
    s: 6, south: 6,
    se: 7, southeast: 7,
    sw: 8, southwest: 8,
    u: 9, up: 9,
    d: 10, down: 10,
    in: 11,
    out: 12,
};

export function parseDirection(dir: unknown): number | undefined {
    if (typeof dir === 'number') {
        return DIR_FIELD[dir] ? dir : undefined;
    }
    if (typeof dir === 'string') {
        return DIR_NAME_TO_INT[dir.toLowerCase()];
    }
    return undefined;
}

// Qt pen-style enum → Mudlet's getCustomLines style strings. Matches the
// mapping used by mudlet-map-binary-reader's reader-export (Qt::SolidLine=1
// through Qt::DashDotDotLine=5).
const PEN_STYLE_NAMES: Record<number, string> = {
    1: 'solid line',
    2: 'dash line',
    3: 'dot line',
    4: 'dash dot line',
    5: 'dash dot dot line',
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

export interface MapLabelInfo {
    X: number; Y: number; Z: number;
    Width: number; Height: number;
    Text: string;
    Pixmap: string;
    OnTop: boolean;
    Scaling: boolean;
    Temporary: boolean;
    FgColor: { r: number; g: number; b: number };
    BgColor: { r: number; g: number; b: number };
}

export type MapLabelLookup =
    | { ok: false; err: 'noarea' | 'noid' }
    | { ok: true; single: MapLabelInfo }
    | { ok: true; multi: Record<number, MapLabelInfo> };

function labelToInfo(l: MudletLabel): MapLabelInfo {
    let pixmap = '';
    const pm = l.pixMap as unknown;
    if (typeof pm === 'string') pixmap = pm;
    else if (pm && typeof Buffer !== 'undefined') {
        try { pixmap = Buffer.from(pm as Uint8Array).toString('base64'); }
        catch { pixmap = ''; }
    }
    return {
        X: l.pos[0], Y: l.pos[1], Z: Math.round(l.pos[2]),
        Width: l.size[0], Height: l.size[1],
        Text: l.text,
        Pixmap: pixmap,
        OnTop: l.showOnTop,
        Scaling: !l.noScaling,
        Temporary: false,  // Mudlet runtime flag; binary maps never carry it
        FgColor: { r: l.fgColor.r, g: l.fgColor.g, b: l.fgColor.b },
        BgColor: { r: l.bgColor.r, g: l.bgColor.g, b: l.bgColor.b },
    };
}

/** Mudlet room highlight: two-color radial gradient with per-color alpha and
 *  a radius factor. Rendered by MudletHighlightOverlay. Despite the suffix
 *  naming, Mudlet's gradient puts color2 at the *centre* and color1 at the
 *  *outer* ring (T2DMap::drawRoom: setColorAt(0, color2), setColorAt(0.85,
 *  color1)). */
export interface RoomHighlight {
    r1: number; g1: number; b1: number;
    r2: number; g2: number; b2: number;
    a1: number; a2: number;
    radius: number;
}

/** Mudlet registerMapInfo callback result. Returned by the LuaRuntime
 *  evaluator after invoking a registered contributor; `null` when the
 *  callback returned an empty string / nothing, or when the evaluator
 *  itself failed (the Lua error is reported via showHandlerError, not here). */
export interface MapInfoResult {
    label: string;
    text: string;
    isBold: boolean;
    isItalic: boolean;
    color?: { r: number; g: number; b: number };
}

/** A registered Mudlet `registerMapInfo` contributor. `callbackId` indexes
 *  into the Lua-side `__mudix_cb` registry; the LuaRuntime evaluator
 *  dispatches to it. Starts disabled (Mudlet semantics — caller must
 *  `enableMapInfo(label)` to show it). */
export interface MapInfoContributor {
    label: string;
    callbackId: number;
    enabled: boolean;
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
    /** Extra arguments captured by addMapEvent. Mudlet's "selection" branch
     *  (the one mudix mirrors, since the right-clicked room is treated as the
     *  selection) discards these — kept for parity with the registration API. */
    args: unknown[];
}

export class MapStore {
    private rooms = new Map<number, MudletRoom>();
    private areas = new Map<number, MudletArea>();
    private areaNames = new Map<number, string>();
    private hashToRoom = new Map<string, number>();
    private labels = new Map<number, MudletLabel[]>();
    private envColors = new Map<number, number>();
    private nextRoomId = 1;
    private nextAreaId = 1;
    private version = 0;
    private subscribers = new Set<() => void>();
    private notifyPending = false;
    // Highlights are a paint-only overlay — they don't affect room/area/exit
    // data, so they go through their own subscription channel. Routing them
    // through the general `notify()` would force MudixMapReader to rebuild
    // its entire snapshot (toMudletMap + readerExport cloneDeep) on every
    // highlightRoom/unHighlightRoom call, which during a speedwalk (where a
    // mapper script updates highlights per move) blocks the main thread for
    // hundreds of ms per step.
    private highlightSubscribers = new Set<() => void>();
    private highlightNotifyPending = false;
    private mapEvents = new Map<string, MapEventEntry>();
    private customEnvColors = new Map<number, MudletColor>();
    private roomHighlights = new Map<number, RoomHighlight>();
    private mapUserData: Record<string, string> = {};
    // Player's current room id, mirrors Mudlet's mRoomIdHash[host.getName()].
    // Updated by centerview (matching Mudlet's centerview-sets-player-room
    // behavior). Read by getPlayerRoom; returns null when unset or the room
    // has since been deleted.
    private playerRoomId: number | null = null;
    // Set by LuaRuntime so dispatchMapEvent can fire raiseEvent into the runtime.
    // Cleared on runtime teardown to avoid firing into a closed lua_State.
    private mapEventDispatcher: ((eventName: string, args: unknown[]) => void) | null = null;
    // Mudlet registerMapInfo contributors. Insertion-ordered so the panel renders
    // entries in registration order (Mudlet behaves the same).
    private mapInfoContributors: MapInfoContributor[] = [];
    // Set by LuaRuntime so evaluateMapInfos can invoke each contributor's
    // Lua callback and capture its multi-return. Cleared on runtime teardown
    // alongside the contributor list — the cb ids are runtime-scoped.
    private mapInfoEvaluator:
        | ((callbackId: number, roomId: number | null, selectionSize: number, areaId: number, displayedAreaId: number) => Omit<MapInfoResult, 'label'> | null)
        | null = null;

    subscribe(cb: () => void): () => void {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
    }

    /** Subscribe to highlight-set changes only (highlightRoom / unHighlightRoom
     *  and bulk clears via newEmptyMap / loadFromBinary). MudletHighlightOverlay
     *  uses this so it re-renders without forcing a full MudixMapReader rebuild. */
    subscribeHighlights(cb: () => void): () => void {
        this.highlightSubscribers.add(cb);
        return () => this.highlightSubscribers.delete(cb);
    }

    private notify(): void {
        this.version++;
        if (this.notifyPending) return;
        this.notifyPending = true;
        queueMicrotask(() => {
            this.notifyPending = false;
            for (const cb of this.subscribers) cb();
        });
    }

    private notifyHighlights(): void {
        if (this.highlightNotifyPending) return;
        this.highlightNotifyPending = true;
        queueMicrotask(() => {
            this.highlightNotifyPending = false;
            for (const cb of this.highlightSubscribers) cb();
        });
    }

    /** Monotonic counter incremented on every mutation. Live readers compare
     *  the snapshot they cached against this to decide whether to rebuild. */
    getVersion(): number { return this.version; }

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
        this.labels.clear();
        this.envColors.clear();
        this.customEnvColors.clear();
        this.roomHighlights.clear();
        this.mapUserData = {};
        this.playerRoomId = null;
        this.nextRoomId = 1;
        this.nextAreaId = 2;        // -1 is reserved below
        const defaultArea = makeArea();
        defaultArea.zLevels = [0];
        this.areas.set(-1, defaultArea);
        this.areaNames.set(-1, 'Default Area');
        this.initialized = true;
        this.notify();
        this.notifyHighlights();
    }

    /**
     * Replace the store's contents with a parsed Mudlet binary map. Loads
     * rooms, areas, area names, hashes, labels, custom env colors, env color
     * palette, and map-level user data. Bumps the id cursors past any binary
     * ids so subsequent {@link createRoomID} / {@link addAreaName} calls don't
     * collide. One notification fires at the end of the batch.
     */
    loadFromBinary(mudletMap: MudletMap): void {
        this.rooms.clear();
        this.areas.clear();
        this.areaNames.clear();
        this.hashToRoom.clear();
        this.labels.clear();
        this.envColors.clear();
        this.customEnvColors.clear();
        this.roomHighlights.clear();
        this.playerRoomId = null;

        for (const [k, room] of Object.entries(mudletMap.rooms ?? {})) {
            const id = Number(k);
            this.rooms.set(id, room);
            if (room.hash) this.hashToRoom.set(room.hash, id);
            if (id >= this.nextRoomId) this.nextRoomId = id + 1;
        }
        // Binary may carry hashes for rooms that haven't been parsed into
        // `rooms` (legacy maps with orphan hash entries). Trust the explicit
        // hash→id table as authoritative when it disagrees.
        for (const [hash, id] of Object.entries(mudletMap.mpRoomDbHashToRoomId ?? {})) {
            this.hashToRoom.set(hash, id);
        }
        for (const [k, area] of Object.entries(mudletMap.areas ?? {})) {
            const id = Number(k);
            this.areas.set(id, area);
            if (id >= this.nextAreaId) this.nextAreaId = id + 1;
        }
        for (const [k, name] of Object.entries(mudletMap.areaNames ?? {})) {
            this.areaNames.set(Number(k), name);
        }
        for (const [k, labels] of Object.entries(mudletMap.labels ?? {})) {
            // Normalize pixmaps to base64 strings up-front. Heavy Buffer
            // payloads here would later get walked by lodash.cloneDeep inside
            // readerExport on every renderer refresh — see MudixMapReader for
            // the strip/patch dance that depends on this normalization.
            const normalized = labels.map(l => {
                const pm = l.pixMap as unknown;
                if (typeof pm === 'string') return l;
                if (!pm) return l;
                try { return { ...l, pixMap: Buffer.from(pm as Uint8Array).toString('base64') }; }
                catch { return { ...l, pixMap: '' }; }
            });
            this.labels.set(Number(k), normalized);
        }
        for (const [k, c] of Object.entries(mudletMap.mCustomEnvColors ?? {})) {
            this.customEnvColors.set(Number(k), c);
        }
        for (const [k, v] of Object.entries(mudletMap.envColors ?? {})) {
            this.envColors.set(Number(k), v);
        }
        this.mapUserData = { ...(mudletMap.mUserData ?? {}) };
        this.initialized = true;
        this.notify();
        this.notifyHighlights();
    }

    toRendererData(): MapRendererData | null {
        if (this.rooms.size === 0) return null;
        try { return readerExport(this.toMudletMap()); } catch { return null; }
    }

    toMudletMap(): MudletMap {
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
        const envColors: Record<number, number> = {};
        for (const [id, v] of this.envColors) envColors[id] = v;
        const labels: Record<number, MudletLabel[]> = {};
        for (const [id, ls] of this.labels) labels[id] = ls;
        return {
            version: 1, envColors, areaNames, mCustomEnvColors,
            mpRoomDbHashToRoomId: hashes, mUserData: { ...this.mapUserData },
            mapSymbolFont: DEFAULT_FONT, mapFontFudgeFactor: 1, useOnlyMapFont: false,
            areas, mRoomIdHash: {}, labels, rooms,
        };
    }

    // ── Room IDs ──────────────────────────────────────────────────────────────

    /**
     * Mudlet `createRoomID([minimum])` — returns the smallest unused room id
     * at or above `minimum` (or above the running cursor if not given). The
     * id isn't reserved; a follow-up `addRoom(id)` is what actually claims it.
     */
    createRoomID(minimum?: number): number {
        let id = minimum != null && Number.isFinite(minimum) && minimum > 0
            ? Math.trunc(minimum)
            : this.nextRoomId;
        while (this.rooms.has(id)) id++;
        if (id >= this.nextRoomId) this.nextRoomId = id + 1;
        return id;
    }

    // ── Room CRUD ─────────────────────────────────────────────────────────────

    addRoom(id: number, areaId?: number): boolean {
        if (this.rooms.has(id)) return false;
        const initialArea = areaId != null && Number.isFinite(areaId) ? Number(areaId) : 0;
        this.rooms.set(id, makeRoom(initialArea));
        if (areaId != null && Number.isFinite(areaId)) {
            const aid = Number(areaId);
            if (!this.areas.has(aid)) {
                this.areas.set(aid, makeArea());
                if (!this.areaNames.has(aid)) this.areaNames.set(aid, `Area ${aid}`);
                if (aid >= this.nextAreaId) this.nextAreaId = aid + 1;
            }
            this.areas.get(aid)!.rooms.push(id);
        }
        this.notify();
        return true;
    }

    deleteRoom(id: number): boolean {
        const room = this.rooms.get(id);
        if (!room) return false;
        const area = this.areas.get(room.area);
        if (area) {
            area.rooms = area.rooms.filter(r => r !== id);
            this.updateAreaBounds(room.area);
        }
        if (room.hash) this.hashToRoom.delete(room.hash);
        this.rooms.delete(id);
        this.notify();
        return true;
    }

    roomExists(id: number): boolean { return this.rooms.has(id); }

    // ── Player position ───────────────────────────────────────────────────────

    /** Mudlet `getPlayerRoom()` — id of the player's current room, or null
     *  when unset or the room no longer exists. */
    getPlayerRoom(): number | null {
        if (this.playerRoomId == null) return null;
        return this.rooms.has(this.playerRoomId) ? this.playerRoomId : null;
    }

    /** Mirror of Mudlet's `mRoomIdHash[host.getName()] = roomId` from centerview.
     *  Stores even unknown ids so a later `addRoom` makes the position valid;
     *  getPlayerRoom does the existence check on read. */
    setPlayerRoom(id: number): void {
        this.playerRoomId = id;
    }

    // ── Room properties ───────────────────────────────────────────────────────

    getRoomName(id: number): string | undefined { return this.rooms.get(id)?.name; }

    setRoomName(id: number, name: string): boolean {
        const r = this.rooms.get(id);
        if (!r) return false;
        r.name = name;
        this.notify();
        return true;
    }

    /** Mudlet `getRoomArea(id)` — area id of the room, or -1 if the room is missing. */
    getRoomArea(id: number): number { return this.rooms.get(id)?.area ?? -1; }

    /**
     * Mudlet `setRoomArea(roomID|{ids}, areaID|areaName)`. Accepts either a
     * single room ID or an array of room IDs, and either a numeric area ID or
     * an area-name string. Returns false if the area name cannot be resolved.
     */
    setRoomArea(id: number | number[], areaIdOrName: number | string): boolean {
        const aid = this.resolveAreaId(areaIdOrName);
        if (aid == null) return false;
        const ids = Array.isArray(id) ? id.map(n => Number(n)).filter(n => Number.isFinite(n)) : [Number(id)];
        let touched = false;
        for (const rid of ids) {
            const room = this.rooms.get(rid);
            if (!room) continue;
            const oldArea = this.areas.get(room.area);
            if (oldArea) {
                oldArea.rooms = oldArea.rooms.filter(r => r !== rid);
                this.updateAreaBounds(room.area);
            }
            if (!this.areas.has(aid)) {
                this.areas.set(aid, makeArea());
                if (!this.areaNames.has(aid)) this.areaNames.set(aid, `Area ${aid}`);
                if (aid >= this.nextAreaId) this.nextAreaId = aid + 1;
            }
            this.areas.get(aid)!.rooms.push(rid);
            room.area = aid;
            this.updateAreaBounds(aid);
            touched = true;
        }
        if (touched) this.notify();
        return touched;
    }

    /** Resolve area-id-or-name → numeric id, or undefined if unknown. */
    private resolveAreaId(idOrName: number | string): number | undefined {
        if (typeof idOrName === 'number') {
            return Number.isFinite(idOrName) ? idOrName : undefined;
        }
        if (typeof idOrName === 'string') {
            const n = Number(idOrName);
            if (Number.isFinite(n) && /^-?\d+$/.test(idOrName.trim())) return n;
            for (const [aid, name] of this.areaNames) if (name === idOrName) return aid;
            return undefined;
        }
        return undefined;
    }

    getRoomCoordinates(id: number): [number, number, number] | undefined {
        const r = this.rooms.get(id);
        return r ? [r.x, r.y, r.z] : undefined;
    }

    setRoomCoordinates(id: number, x: number, y: number, z: number): boolean {
        const room = this.rooms.get(id);
        if (!room) return false;
        room.x = x; room.y = y; room.z = z;
        this.updateAreaBounds(room.area);
        const area = this.areas.get(room.area);
        if (area && !area.zLevels.includes(z)) {
            area.zLevels.push(z);
            area.zLevels.sort((a, b) => a - b);
        }
        this.notify();
        return true;
    }

    /**
     * Mudlet `getRoomEnv(id)` — environment color id, or -1 if the room is
     * missing. (Rooms without an env override still report their stored value.)
     */
    getRoomEnv(id: number): number {
        return this.rooms.get(id)?.environment ?? -1;
    }

    setRoomEnv(id: number, env: number): boolean {
        const r = this.rooms.get(id);
        if (!r) return false;
        r.environment = env;
        this.notify();
        return true;
    }

    getRoomChar(id: number): string { return this.rooms.get(id)?.symbol ?? ''; }

    setRoomChar(id: number, char: string): boolean {
        const r = this.rooms.get(id);
        if (!r) return false;
        r.symbol = char;
        this.notify();
        return true;
    }

    /**
     * Mudlet `lockRoom(roomID, lockIfTrue)` — mark a room as locked so
     * pathfinding routes around it (see {@link findPath}). Returns true on
     * success, false when the room doesn't exist.
     */
    lockRoom(id: number, lock: boolean): boolean {
        const r = this.rooms.get(id);
        if (!r) return false;
        r.isLocked = lock;
        this.notify();
        return true;
    }

    /**
     * Mudlet `roomLocked(roomID)` — true when the room is locked, false when
     * unlocked or the room doesn't exist (Mudlet returns nil for a missing
     * room; the Lua binding re-shapes that case).
     */
    roomLocked(id: number): boolean {
        return this.rooms.get(id)?.isLocked ?? false;
    }

    /**
     * Mudlet `getRoomWeight(roomID)` — the room's pathfinding weight (cost to
     * enter). Returns `undefined` when the room doesn't exist; the Lua binding
     * turns that into Mudlet's "no return value" miss.
     */
    getRoomWeight(id: number): number | undefined {
        return this.rooms.get(id)?.weight;
    }

    /**
     * Mudlet `setRoomWeight(roomID, weight)` — set the room's pathfinding
     * weight. Mudlet rejects negative weights (0 is allowed). Returns true on
     * success, false when the room doesn't exist or the weight is invalid.
     */
    setRoomWeight(id: number, weight: number): boolean {
        const r = this.rooms.get(id);
        if (!r) return false;
        if (!Number.isFinite(weight) || weight < 0) return false;
        r.weight = weight;
        this.notify();
        return true;
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

    /**
     * Mudlet `setExit(from, to, dir)` — `dir` is either a 1-12 integer or a
     * direction name ("north"/"n"/etc.). Returns true on success.
     */
    setExit(from: number, to: number, dir: number | string): boolean {
        const room = this.rooms.get(from);
        if (!room) return false;
        const dirInt = parseDirection(dir);
        if (dirInt == null) return false;
        const field = DIR_FIELD[dirInt];
        (room as unknown as Record<string, number>)[field] = to;
        if (to >= 0) room.stubs = room.stubs.filter(s => s !== dirInt);
        this.notify();
        return true;
    }

    getExitStubs(id: number): number[] { return [...(this.rooms.get(id)?.stubs ?? [])]; }

    /** Mudlet `findPath(from, to)` — see {@link findPath} in `./pathfinding`
     *  for the algorithm (A* with Mudlet's Euclidean-or-1 heuristic). */
    findPath(from: number, to: number): PathfindResult | null {
        return findPath(this.rooms, from, to);
    }

    setExitStub(id: number, dir: number | string, set: boolean): boolean {
        const room = this.rooms.get(id);
        if (!room) return false;
        const dirInt = parseDirection(dir);
        if (dirInt == null) return false;
        if (set) { if (!room.stubs.includes(dirInt)) room.stubs.push(dirInt); }
        else room.stubs = room.stubs.filter(s => s !== dirInt);
        this.notify();
        return true;
    }

    addSpecialExit(from: number, to: number, cmd: string): boolean {
        const r = this.rooms.get(from);
        if (!r) return false;
        r.mSpecialExits[cmd] = to;
        this.notify();
        return true;
    }

    removeSpecialExit(from: number, cmd: string): boolean {
        const r = this.rooms.get(from);
        if (!r) return false;
        if (!(cmd in r.mSpecialExits)) return false;
        delete r.mSpecialExits[cmd];
        this.notify();
        return true;
    }

    getSpecialExitsSwap(id: number): Record<string, number> {
        return { ...(this.rooms.get(id)?.mSpecialExits ?? {}) };
    }

    /**
     * Mudlet `getSpecialExits(roomID [, listAllExits])` — special exits keyed by
     * destination room id: `{ [exitRoomID] = { [command] = "0"|"1" } }`, where
     * "1" marks a locked exit. When several commands lead to the same room and
     * `listAllExits` is false (the default), only the lowest-weight command is
     * reported; pass `true` to list every command. Returns `{}` for a missing
     * room. The lock flag follows this client's data model (special-exit locks
     * are tracked by destination room id, see pathfinding.ts).
     */
    getSpecialExits(id: number, listAllExits = false): Record<number, Record<string, string>> {
        const room = this.rooms.get(id);
        if (!room) return {};
        const locks = room.mSpecialExitLocks ?? [];
        const weights = room.exitWeights ?? {};
        // Group the commands leading to each destination room.
        const byDest = new Map<number, string[]>();
        for (const [cmd, dest] of Object.entries(room.mSpecialExits ?? {})) {
            const list = byDest.get(dest);
            if (list) list.push(cmd);
            else byDest.set(dest, [cmd]);
        }
        const out: Record<number, Record<string, string>> = {};
        for (const [dest, cmds] of byDest) {
            const lock = locks.includes(dest) ? '1' : '0';
            const inner: Record<string, string> = {};
            if (listAllExits || cmds.length === 1) {
                for (const cmd of cmds) inner[cmd] = lock;
            } else {
                // Pick the lowest-weight command to this destination (locks are
                // per-destination here, so the unlocked/locked split Mudlet does
                // is degenerate — every command shares the same lock state).
                let best: string | null = null;
                let bestWeight = Infinity;
                for (const cmd of cmds) {
                    const w = weights[cmd] ?? 1;
                    if (w < bestWeight) { bestWeight = w; best = cmd; }
                }
                if (best != null) inner[best] = lock;
            }
            out[dest] = inner;
        }
        return out;
    }

    /**
     * Mudlet `getExitWeights(roomID)` — per-exit weight overrides as
     * `{ [exit] = weight }`. Stock exits are keyed by their short direction name
     * ("n"/"ne"/"up"/…), special exits by the verbatim command. Returns `{}`
     * when the room has no overrides or doesn't exist.
     */
    getExitWeights(id: number): Record<string, number> {
        return { ...(this.rooms.get(id)?.exitWeights ?? {}) };
    }

    /**
     * Mudlet `setExitWeight(roomID, exitCommand, weight)` — override the weight
     * of a single exit. `exitCommand` is a stock direction (1-12 or a name) or a
     * special-exit command. A weight of 0 resets the override (pathfinding falls
     * back to the destination room's weight); negative weights are rejected.
     * Returns false when the room doesn't exist, the exit can't be identified,
     * or the weight is invalid.
     */
    setExitWeight(id: number, exitCommand: number | string, weight: number): boolean {
        const room = this.rooms.get(id);
        if (!room) return false;
        if (!Number.isFinite(weight) || weight < 0) return false;
        const dirInt = parseDirection(exitCommand);
        let key: string;
        if (dirInt != null) {
            // Stock direction: the exit must actually exist on the room.
            const field = DIR_FIELD[dirInt];
            if ((room as unknown as Record<string, number>)[field] === -1) return false;
            key = DIR_SHORT[dirInt];
        } else if (typeof exitCommand === 'string' && exitCommand in room.mSpecialExits) {
            key = exitCommand;
        } else {
            return false;
        }
        if (weight === 0) delete room.exitWeights[key];
        else room.exitWeights[key] = weight;
        this.notify();
        return true;
    }

    // ── Custom exit lines ─────────────────────────────────────────────────────

    /**
     * Mudlet `getCustomLines(roomID)` — per-direction custom exit lines drawn
     * on the map. Returns `undefined` when the room doesn't exist so the Lua
     * wrapper can hand back `nil`; otherwise a `{ dir = { attributes, points } }`
     * table (empty when the room has no custom lines). Points carry the room's
     * Z because Mudlet stores only X/Y per point and uses the owning room's Z
     * for rendering.
     */
    getCustomLines(id: number): Record<string, {
        attributes: { color: { r: number; g: number; b: number }; style: string; arrow: boolean };
        points: Array<{ x: number; y: number; z: number }>;
    }> | undefined {
        const room = this.rooms.get(id);
        if (!room) return undefined;
        const out: Record<string, {
            attributes: { color: { r: number; g: number; b: number }; style: string; arrow: boolean };
            points: Array<{ x: number; y: number; z: number }>;
        }> = {};
        for (const key of Object.keys(room.customLines ?? {})) {
            const color = room.customLinesColor?.[key];
            const styleNum = room.customLinesStyle?.[key] ?? 1;
            out[key] = {
                attributes: {
                    color: color ? { r: color.r, g: color.g, b: color.b } : { r: 255, g: 255, b: 255 },
                    style: PEN_STYLE_NAMES[styleNum] ?? 'solid line',
                    arrow: !!room.customLinesArrow?.[key],
                },
                points: (room.customLines[key] ?? []).map(([x, y]) => ({ x, y, z: room.z })),
            };
        }
        return out;
    }

    // ── Doors ─────────────────────────────────────────────────────────────────

    getDoors(id: number): Record<string, number> {
        return { ...(this.rooms.get(id)?.doors ?? {}) };
    }

    /**
     * Mudlet `setDoor(roomID, exitCmd, status)`. exitCmd is either a stock
     * direction (numeric 1-12 or name like "north"/"n"), in which case the
     * door is keyed by the canonical field name ("north"/"northeast"/...), or
     * an arbitrary special-exit command string, which is used as-is.
     */
    setDoor(id: number, dir: number | string, val: number): boolean {
        const room = this.rooms.get(id);
        if (!room) return false;
        const dirInt = parseDirection(dir);
        const key = dirInt != null ? DIR_FIELD[dirInt] : (typeof dir === 'string' ? dir : '');
        if (!key) return false;
        if (val <= 0) delete room.doors[key];
        else room.doors[key] = val;
        this.notify();
        return true;
    }

    // ── User data ─────────────────────────────────────────────────────────────

    /**
     * Mudlet `getRoomUserData(id, key)` — returns the stored value, or
     * `undefined` when either the room or the key is missing. The Lua binding
     * differentiates the two cases when the script asks for the full-error
     * shape (`fullErr=true`).
     */
    getRoomUserData(id: number, key: string): string | undefined {
        const room = this.rooms.get(id);
        if (!room) return undefined;
        return Object.prototype.hasOwnProperty.call(room.userData, key)
            ? room.userData[key]
            : undefined;
    }

    setRoomUserData(id: number, key: string, value: string): boolean {
        const r = this.rooms.get(id);
        if (!r) return false;
        r.userData[key] = value;
        this.notify();
        return true;
    }

    /**
     * Mudlet `getRoomUserDataKeys(id)` — returns the user-data keys for the
     * room (possibly empty) or `undefined` when the room itself does not
     * exist. The Bridge.lua wrapper converts the JS array to a 1-indexed Lua
     * table and the `undefined` miss to `nil`.
     */
    getRoomUserDataKeys(id: number): string[] | undefined {
        const room = this.rooms.get(id);
        if (!room) return undefined;
        return Object.keys(room.userData);
    }

    // ── Map-level user data ───────────────────────────────────────────────────
    // Mudlet getMapUserData/setMapUserData/clearMapUserData operate on the
    // map's mUserData dict. Loaded binary maps populate this via
    // loadMapUserData(); scripts use it as free-form key/value storage that
    // survives serialization back to .dat.

    /**
     * Mudlet `getMapUserData(key)` — returns the stored value, or `undefined`
     * when the key has never been set. The Lua binding turns the missing case
     * into Mudlet's `(false, errMsg)` 2-tuple.
     */
    getMapUserData(key: string): string | undefined {
        return Object.prototype.hasOwnProperty.call(this.mapUserData, key)
            ? this.mapUserData[key]
            : undefined;
    }

    setMapUserData(key: string, value: string): void {
        this.mapUserData[key] = value;
        this.notify();
    }

    /**
     * Mudlet `clearMapUserData()` (no args) wipes the entire map-level user
     * data dict — used by scripts that want a clean slate when re-importing
     * data. The single-key form is exposed under `clearMapUserDataItem` to
     * match Mudlet's split.
     */
    clearMapUserData(): boolean {
        if (Object.keys(this.mapUserData).length === 0) return false;
        this.mapUserData = {};
        this.notify();
        return true;
    }

    clearMapUserDataItem(key: string): boolean {
        if (!(key in this.mapUserData)) return false;
        delete this.mapUserData[key];
        this.notify();
        return true;
    }

    getAllMapUserData(): Record<string, string> {
        return { ...this.mapUserData };
    }

    /** Replace the entire map-level user-data dict (e.g. after loading a .dat). */
    loadMapUserData(data: Record<string, string> | undefined | null): void {
        this.mapUserData = data ? { ...data } : {};
        this.notify();
    }

    // ── Areas ─────────────────────────────────────────────────────────────────

    /**
     * Mudlet `addAreaName(name)` returns a numeric area ID on success or
     * `(false, errMsg)` when the name is empty or already in use.
     */
    addAreaName(name: string): number | { ok: false; err: string } {
        if (typeof name !== 'string' || name.length === 0) {
            return { ok: false, err: 'addAreaName: area name must be a non-empty string' };
        }
        for (const [, n] of this.areaNames) {
            if (n === name) return { ok: false, err: `addAreaName: an area called "${name}" already exists` };
        }
        const id = this.nextAreaId++;
        this.areas.set(id, makeArea());
        this.areaNames.set(id, name);
        this.notify();
        return id;
    }

    /**
     * Mudlet `deleteArea(areaID|areaName)` — deletes the area record and the
     * rooms it contained. Returns true on success, false if the area can't be
     * resolved.
     */
    deleteArea(idOrName: number | string): boolean {
        const id = this.resolveAreaId(idOrName);
        if (id == null) return false;
        const area = this.areas.get(id);
        if (!area) return false;
        for (const roomId of area.rooms) {
            const r = this.rooms.get(roomId);
            if (r?.hash) this.hashToRoom.delete(r.hash);
            this.rooms.delete(roomId);
        }
        this.areas.delete(id);
        this.areaNames.delete(id);
        this.notify();
        return true;
    }

    getAreaTable(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const [id, name] of this.areaNames) out[name] = id;
        return out;
    }

    /**
     * Mudlet `getRoomAreaName(areaID|areaName)` — bidirectional. Given an ID
     * returns the name; given a name returns the ID. Returns undefined when
     * the input cannot be resolved.
     */
    getRoomAreaName(idOrName: number | string): string | number | undefined {
        if (typeof idOrName === 'number') {
            return this.areaNames.get(idOrName);
        }
        if (typeof idOrName === 'string') {
            for (const [aid, name] of this.areaNames) if (name === idOrName) return aid;
            return undefined;
        }
        return undefined;
    }

    /**
     * Mudlet `setAreaName(areaID|areaName, newName) → true | false, errMsg`.
     * Rejects empty new names and names that conflict with another area.
     */
    setAreaName(idOrName: number | string, newName: string): boolean | { ok: false; err: string } {
        if (typeof newName !== 'string' || newName.length === 0) {
            return { ok: false, err: 'setAreaName: new area name must be a non-empty string' };
        }
        const id = this.resolveAreaId(idOrName);
        if (id == null || !this.areaNames.has(id)) {
            return { ok: false, err: 'setAreaName: area not found' };
        }
        for (const [aid, n] of this.areaNames) {
            if (aid !== id && n === newName) {
                return { ok: false, err: `setAreaName: an area called "${newName}" already exists` };
            }
        }
        this.areaNames.set(id, newName);
        this.notify();
        return true;
    }

    getAreaRooms(areaId: number): number[] {
        return [...(this.areas.get(areaId)?.rooms ?? [])];
    }

    getRooms(): Record<number, string> {
        const out: Record<number, string> = {};
        for (const [id, r] of this.rooms) out[id] = r.name;
        return out;
    }

    /**
     * Mudlet `getMapLabels(areaID)` — returns `{ [labelID] = labelText }` for
     * every label in the area, or an empty object if the area has none / is
     * unknown. Each `MudletLabel.id` is the QMap key Mudlet uses internally,
     * which is also what `deleteMapLabel` expects.
     */
    getMapLabels(areaId: number): Record<number, string> {
        const out: Record<number, string> = {};
        for (const l of this.labels.get(areaId) ?? []) out[l.id] = l.text;
        return out;
    }

    /**
     * Mudlet `getMapLabel(areaID, labelID|labelText)`:
     *  - by ID (number): single flat properties record, or "noid" sentinel if the
     *    area has labels but not that ID
     *  - by text (string): `{[labelID]: properties}` for every label whose text
     *    matches exactly (possibly empty)
     *  - if the area has no labels at all: empty `multi: {}` regardless of key form
     *    (matches Mudlet's early-return)
     *  - if the area is missing: "noarea" sentinel
     *
     * Bridge.lua dispatches the sentinels into Mudlet's `(false, errMsg)` shape.
     */
    getMapLabel(areaId: number, key: number | string): MapLabelLookup {
        if (!this.areas.has(areaId)) return { ok: false, err: 'noarea' };
        const labels = this.labels.get(areaId) ?? [];
        if (labels.length === 0) return { ok: true, multi: {} };
        if (typeof key === 'number') {
            const hit = labels.find(l => l.id === key);
            if (!hit) return { ok: false, err: 'noid' };
            return { ok: true, single: labelToInfo(hit) };
        }
        const multi: Record<number, MapLabelInfo> = {};
        for (const l of labels) {
            if (l.text === key) multi[l.id] = labelToInfo(l);
        }
        return { ok: true, multi };
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

    /** Fire the registered event for a context-menu entry. Matches Mudlet's
     *  T2DMap::slot_userAction selection branch: raiseEvent(eventName,
     *  uniqueName, roomId). The right-clicked room stands in for Mudlet's
     *  multi-room selection; the entry's stored extra args are discarded
     *  (Mudlet does the same in this branch). */
    dispatchMapEvent(uniqueName: string, roomId: number): void {
        const entry = this.mapEvents.get(uniqueName);
        if (!entry) return;
        this.mapEventDispatcher?.(entry.eventName, [uniqueName, roomId]);
    }

    // ── Map info contributors (Mudlet registerMapInfo) ────────────────────────

    setMapInfoEvaluator(fn: MapStore['mapInfoEvaluator']): void {
        this.mapInfoEvaluator = fn;
    }

    /** Add or replace a contributor. Re-registering the same label keeps the
     *  current enabled state and returns the prior callbackId so the runtime
     *  can free the leaked Lua-registry slot. */
    registerMapInfo(label: string, callbackId: number): { prevCallbackId: number | null } {
        const idx = this.mapInfoContributors.findIndex(c => c.label === label);
        let prev: number | null = null;
        if (idx >= 0) {
            prev = this.mapInfoContributors[idx].callbackId;
            this.mapInfoContributors[idx] = { label, callbackId, enabled: this.mapInfoContributors[idx].enabled };
        } else {
            this.mapInfoContributors.push({ label, callbackId, enabled: false });
        }
        this.notify();
        return { prevCallbackId: prev };
    }

    /** Remove a contributor entirely. Returns the freed callbackId (so the
     *  runtime can release the Lua-registry slot) or null when the label
     *  wasn't registered. */
    killMapInfo(label: string): { callbackId: number | null; removed: boolean } {
        const idx = this.mapInfoContributors.findIndex(c => c.label === label);
        if (idx < 0) return { callbackId: null, removed: false };
        const cb = this.mapInfoContributors[idx].callbackId;
        this.mapInfoContributors.splice(idx, 1);
        this.notify();
        return { callbackId: cb, removed: true };
    }

    enableMapInfo(label: string): boolean {
        const c = this.mapInfoContributors.find(c => c.label === label);
        if (!c) return false;
        if (c.enabled) return true;
        c.enabled = true;
        this.notify();
        return true;
    }

    disableMapInfo(label: string): boolean {
        const c = this.mapInfoContributors.find(c => c.label === label);
        if (!c) return false;
        if (!c.enabled) return true;
        c.enabled = false;
        this.notify();
        return true;
    }

    /** Snapshot for tests / debug. The panel goes through evaluateMapInfos. */
    getMapInfoContributors(): MapInfoContributor[] {
        return this.mapInfoContributors.map(c => ({ ...c }));
    }

    /** Run every enabled contributor through the LuaRuntime evaluator and
     *  collect their (text, style, color) results. Empty when the evaluator
     *  is unhooked or no contributor returned a non-empty text. */
    evaluateMapInfos(
        roomId: number | null,
        selectionSize: number,
        areaId: number,
        displayedAreaId: number,
    ): MapInfoResult[] {
        const evaluator = this.mapInfoEvaluator;
        if (!evaluator || this.mapInfoContributors.length === 0) return [];
        const out: MapInfoResult[] = [];
        for (const c of this.mapInfoContributors) {
            if (!c.enabled) continue;
            const r = evaluator(c.callbackId, roomId, selectionSize, areaId, displayedAreaId);
            if (r && r.text) out.push({ label: c.label, ...r });
        }
        return out;
    }

    /** Drop every registered contributor. Called on LuaRuntime teardown — the
     *  callback IDs index into the dying runtime's __mudix_cb registry. */
    clearMapInfoContributors(): void {
        if (this.mapInfoContributors.length === 0) return;
        this.mapInfoContributors = [];
        this.notify();
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

    getCustomEnvColorTable(): Record<number, { r: number; g: number; b: number; a: number }> {
        const out: Record<number, { r: number; g: number; b: number; a: number }> = {};
        for (const [id, c] of this.customEnvColors) {
            out[id] = { r: c.r, g: c.g, b: c.b, a: c.alpha };
        }
        return out;
    }

    // ── Room highlights (Mudlet highlightRoom / unHighlightRoom) ──────────────

    /**
     * Mudlet highlightRoom(roomID, r1, g1, b1, r2, g2, b2, radius, a1, a2).
     * Painted by MudletHighlightOverlay as a radial gradient: color1 (with
     * a1 alpha) at the center, color2 (with a2 alpha) at the outer edge,
     * with the circle radius = settings.roomSize × `radius`. Returns false
     * if the room does not exist.
     */
    highlightRoom(
        id: number,
        r1: number, g1: number, b1: number,
        r2: number, g2: number, b2: number,
        radius: number,
        a1 = 255, a2 = 255,
    ): boolean {
        if (!this.rooms.has(id)) return false;
        this.roomHighlights.set(id, { r1, g1, b1, r2, g2, b2, a1, a2, radius });
        this.notifyHighlights();
        return true;
    }

    /** Mudlet unHighlightRoom(roomID). Returns false when the room had no highlight. */
    unHighlightRoom(id: number): boolean {
        if (!this.roomHighlights.delete(id)) return false;
        this.notifyHighlights();
        return true;
    }

    /** Snapshot of all active room highlights. MapPanel reads this each store
     *  notify to reconcile the renderer's overlay shapes against the store. */
    getRoomHighlights(): Map<number, RoomHighlight> {
        return this.roomHighlights;
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
