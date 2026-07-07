/**
 * Mudlet XML map import — the IRE-style `map.xml` format games publish via
 * GMCP `Client.Map` (MMP) and that Mudlet's `loadMap("...xml")` accepts.
 * Faithful port of XMLimport::readMap/readArea/readRoom/readEnvColor
 * (Mudlet src/XMLimport.cpp), producing the same in-memory `MudletMap` shape
 * the binary reader yields so `MapStore.loadFromBinary` can ingest it.
 *
 * Format sketch:
 *
 *   <map>
 *     <areas><area id="2" name="Riverside"/></areas>
 *     <rooms>
 *       <room id="1" area="2" title="On a hill" environment="3">
 *         <coord x="0" y="0" z="0"/>
 *         <exit direction="north" target="2" door="1"/>
 *         <exit special="1" command="enter hole" target="7" hidden="1"/>
 *       </room>
 *     </rooms>
 *     <environments><environment id="3" color="4"/></environments>
 *   </map>
 */
import type { MudletMap, MudletRoom } from 'mudlet-map-binary-reader';
import { makeRoom, makeArea, DEFAULT_FONT } from './MapStore';

// XML exit direction → MudletRoom field + door key, exactly the pairs
// XMLimport::readRoom recognises (unknown directions are ignored there too).
const EXIT_DIRS: Record<string, { field: string; door: string }> = {
    north:     { field: 'north',     door: 'n' },
    east:      { field: 'east',      door: 'e' },
    south:     { field: 'south',     door: 's' },
    west:      { field: 'west',      door: 'w' },
    up:        { field: 'up',        door: 'up' },
    down:      { field: 'down',      door: 'down' },
    northeast: { field: 'northeast', door: 'ne' },
    southwest: { field: 'southwest', door: 'sw' },
    southeast: { field: 'southeast', door: 'se' },
    northwest: { field: 'northwest', door: 'nw' },
    in:        { field: 'in',        door: 'in' },
    out:       { field: 'out',       door: 'out' },
};

/** Qt QString::toInt semantics — non-numeric attributes read as 0. */
function toInt(value: string | null): number {
    const n = parseInt(value ?? '', 10);
    return Number.isFinite(n) ? n : 0;
}

/** XMLimport::readRoom door logic: a hidden="1" exit is a locked door (3);
 *  otherwise door="0..3" is taken verbatim; anything else means no door. */
function doorValue(exit: Element): number {
    if (exit.hasAttribute('hidden') && toInt(exit.getAttribute('hidden')) === 1) return 3;
    if (exit.hasAttribute('door')) {
        const door = toInt(exit.getAttribute('door'));
        if (door >= 0 && door <= 3) return door;
    }
    return 0;
}

function readRoom(el: Element): { id: number; room: MudletRoom } | null {
    const id = toInt(el.getAttribute('id'));
    // Mudlet skips rooms with id < 1 outright.
    if (id < 1) return null;
    const room = makeRoom(toInt(el.getAttribute('area')));
    room.name = el.getAttribute('title') ?? '';
    room.environment = toInt(el.getAttribute('environment'));

    for (const child of Array.from(el.children)) {
        if (child.tagName === 'exit') {
            const target = toInt(child.getAttribute('target'));
            const door = doorValue(child);
            const dir = child.getAttribute('direction') ?? '';
            if (dir === '') {
                // IRE XML maps mark special exits with special="1" + command
                // rather than a custom direction string.
                const command = child.getAttribute('command') ?? '';
                if (toInt(child.getAttribute('special')) === 1 && command !== '') {
                    room.mSpecialExits[command] = target;
                    if (door > 0) room.doors[command] = door;
                }
            } else {
                const known = EXIT_DIRS[dir];
                if (known) {
                    (room as unknown as Record<string, number>)[known.field] = target;
                    if (door > 0) room.doors[known.door] = door;
                }
            }
        } else if (child.tagName === 'coord') {
            // Mudlet skips a <coord> whose x attribute is empty.
            const x = child.getAttribute('x');
            if (x == null || x === '') continue;
            room.x = toInt(x);
            room.y = toInt(child.getAttribute('y'));
            room.z = toInt(child.getAttribute('z'));
        } else if (child.tagName === 'features') {
            // XMLimport::readRoomFeature: each type lands in userData as
            // feature-<type> = "true".
            for (const feature of Array.from(child.children)) {
                if (feature.tagName !== 'feature') continue;
                const type = feature.getAttribute('type');
                if (type) room.userData[`feature-${type}`] = 'true';
            }
        }
    }
    return { id, room };
}

/**
 * Parse an XML map document into the `MudletMap` shape `loadFromBinary`
 * ingests. Returns null when the text isn't well-formed XML or the root
 * element isn't `<map>` (e.g. an HTML error page served for the map URL).
 */
export function parseXmlMap(xmlText: string): MudletMap | null {
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    } catch {
        return null;
    }
    const root = doc.documentElement;
    // Malformed XML surfaces as a <parsererror> document (root or nested,
    // depending on the engine) rather than a thrown error.
    if (!root || root.tagName !== 'map') return null;
    if (root.getElementsByTagName('parsererror').length > 0) return null;

    const map: MudletMap = {
        version: 20, envColors: {}, areaNames: {}, mCustomEnvColors: {},
        mpRoomDbHashToRoomId: {}, mUserData: {},
        mapSymbolFont: DEFAULT_FONT, mapFontFudgeFactor: 1, useOnlyMapFont: false,
        areas: {}, mRoomIdHash: {}, labels: {}, rooms: {},
    };

    // <areas><area id name/></areas> — XMLimport::readArea requires the id.
    for (const areaEl of Array.from(root.getElementsByTagName('area'))) {
        if (!areaEl.hasAttribute('id')) continue;
        const id = toInt(areaEl.getAttribute('id'));
        map.areas[id] = makeArea();
        map.areaNames[id] = areaEl.getAttribute('name') ?? '';
    }

    for (const roomEl of Array.from(root.getElementsByTagName('room'))) {
        const parsed = readRoom(roomEl);
        if (parsed) map.rooms[parsed.id] = parsed.room;
    }

    // <environments><environment id color/></environments>
    for (const envEl of Array.from(root.getElementsByTagName('environment'))) {
        map.envColors[toInt(envEl.getAttribute('id'))] = toInt(envEl.getAttribute('color'));
    }

    // Tail of XMLimport::readMap + the audit() pass Mudlet runs after import:
    // assign every room to its area (auto-creating areas the file references
    // but never declares) and recompute the per-area z-levels and bounds the
    // binary format normally carries precomputed.
    for (const [key, room] of Object.entries(map.rooms)) {
        const id = Number(key);
        let area = map.areas[room.area];
        if (!area) {
            area = makeArea();
            map.areas[room.area] = area;
            map.areaNames[room.area] = `Area ${room.area}`;
        }
        area.rooms.push(id);
        if (!area.zLevels.includes(room.z)) area.zLevels.push(room.z);
        if (area.rooms.length === 1) {
            area.min_x = area.max_x = room.x;
            area.min_y = area.max_y = room.y;
            area.min_z = area.max_z = room.z;
        } else {
            area.min_x = Math.min(area.min_x, room.x); area.max_x = Math.max(area.max_x, room.x);
            area.min_y = Math.min(area.min_y, room.y); area.max_y = Math.max(area.max_y, room.y);
            area.min_z = Math.min(area.min_z, room.z); area.max_z = Math.max(area.max_z, room.z);
        }
    }
    for (const area of Object.values(map.areas)) area.zLevels.sort((a, b) => a - b);

    // Mudlet's audit() guarantees the -1 default area exists on every map.
    if (!map.areas[-1]) {
        const defaultArea = makeArea();
        defaultArea.zLevels = [0];
        map.areas[-1] = defaultArea;
        map.areaNames[-1] = 'Default Area';
    }

    return map;
}
