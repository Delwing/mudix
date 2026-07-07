import { describe, it, expect } from 'vitest';
import { writeMapToBuffer } from 'mudlet-map-binary-reader';
import { parseXmlMap } from '../../src/map/xmlMapImport';
import { MapStore } from '../../src/map/MapStore';

// IRE-style XML map (the GMCP Client.Map / MMP download format), matching the
// shape Mudlet's XMLimport::readMap consumes. The importer must mirror its
// semantics: title→name, coord→x/y/z, full-word exit directions with short
// door keys, hidden="1"→locked door, special="1"+command→special exit,
// feature→userData, environment→envColors, undeclared areas auto-created.
const SAMPLE = `<?xml version="1.0"?>
<map>
  <areas>
    <area id="2" name="Riverside"/>
  </areas>
  <rooms>
    <room id="1" area="2" title="On a hill" environment="3">
      <coord x="5" y="-2" z="1"/>
      <exit direction="north" target="2" door="1"/>
      <exit direction="southwest" target="3" hidden="1"/>
      <exit special="1" command="enter hole" target="4"/>
      <features>
        <feature type="shop"/>
      </features>
    </room>
    <room id="2" area="2" title="Riverbank" environment="3">
      <coord x="5" y="-1" z="1"/>
      <exit direction="south" target="1"/>
    </room>
    <room id="4" area="9" title="A hole">
      <coord x="0" y="0" z="0"/>
    </room>
    <room id="0" area="2" title="Invalid — id below 1"/>
  </rooms>
  <environments>
    <environment id="3" color="4"/>
  </environments>
</map>`;

describe('parseXmlMap', () => {
    it('imports rooms, exits, doors, special exits, features, and env colors', () => {
        const map = parseXmlMap(SAMPLE);
        expect(map).not.toBeNull();
        const room1 = map!.rooms[1];
        expect(room1.name).toBe('On a hill');
        expect(room1.area).toBe(2);
        expect(room1.environment).toBe(3);
        expect([room1.x, room1.y, room1.z]).toEqual([5, -2, 1]);
        expect(room1.north).toBe(2);
        expect(room1.doors['n']).toBe(1);
        // hidden="1" → locked door (3) on the sw exit
        expect(room1.southwest).toBe(3);
        expect(room1.doors['sw']).toBe(3);
        // IRE special exit: empty direction + special="1" + command
        expect(room1.mSpecialExits['enter hole']).toBe(4);
        expect(room1.userData['feature-shop']).toBe('true');

        expect(map!.rooms[2].south).toBe(1);
        expect(map!.rooms[2].doors['s']).toBeUndefined();

        // Rooms with id < 1 are dropped, like Mudlet's readRoom.
        expect(map!.rooms[0]).toBeUndefined();

        expect(map!.envColors[3]).toBe(4);
        expect(map!.areaNames[2]).toBe('Riverside');
    });

    it('assigns rooms to areas, auto-creating areas the file never declared', () => {
        const map = parseXmlMap(SAMPLE)!;
        expect(map.areas[2].rooms.sort()).toEqual([1, 2]);
        // Area 9 is referenced by room 4 but absent from <areas>.
        expect(map.areas[9]).toBeDefined();
        expect(map.areas[9].rooms).toEqual([4]);
        // Computed geometry the binary format normally carries precomputed.
        expect(map.areas[2].zLevels).toEqual([1]);
        expect(map.areas[2].min_y).toBe(-2);
        expect(map.areas[2].max_y).toBe(-1);
        // Mudlet's audit() guarantees the -1 default area.
        expect(map.areas[-1]).toBeDefined();
    });

    it('rejects non-XML and non-map documents', () => {
        expect(parseXmlMap('<html><body>404 Not Found</body></html>')).toBeNull();
        expect(parseXmlMap('PK binary junk')).toBeNull();
        expect(parseXmlMap('')).toBeNull();
        expect(parseXmlMap('<map><rooms><room id="1"</rooms></map>')).toBeNull();
    });

    it('produces a map MapStore can ingest and re-save as binary', () => {
        const map = parseXmlMap(SAMPLE)!;
        const store = new MapStore();
        store.loadFromBinary(map);
        expect(store.roomExists(1)).toBe(true);
        expect(store.getRoomName(1)).toBe('On a hill');
        expect(store.getRoomExits(2)).toEqual({ south: 1 });
        expect(store.getRoomAreaName(2)).toBe('Riverside');
        // The XML import persists via the binary writer — prove the shape is
        // fully save-compatible (this is what scheduleMapSave serialises).
        const bytes = writeMapToBuffer(store.toMudletMapForSave());
        expect(bytes.byteLength).toBeGreaterThan(0);
    });
});
