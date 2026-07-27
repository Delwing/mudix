// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { readMapFromBuffer, streamRooms, writeMapToBuffer, type MudletRoom } from 'mudlet-map-binary-reader';
import { MapStore } from '../../src/map/MapStore';

/**
 * `WindowManager.ingestMapBufferAsync` no longer parses a whole `MudletMap` and
 * structured-clones it back from the worker; it drives MapStore's three-phase
 * load (beginBinaryLoad → ingestBinaryRooms* → endBinaryLoad) from
 * `streamRooms`, so neither side ever holds two copies of the room graph.
 *
 * The contract that buys is exactness: a streamed load must land the same store
 * state as the eager one. The two paths differ in ways that are easy to get
 * wrong — streamed rooms carry no `hash` field (it lives only in the header's
 * `mpRoomDbHashToRoomId`), and the hidden-room / player-room / id-cursor
 * bookkeeping that used to run inline now straddles three calls.
 */

/** A map exercising every field the load phases touch: hashes, a hidden room,
 *  labels, custom env colours, area names, per-room user data, and a saved
 *  player position. */
function buildSourceMap() {
    const store = new MapStore();
    store.profileName = 'tester';
    const areaId = store.addAreaName('Test Area');
    expect(typeof areaId).toBe('number');
    for (let id = 1; id <= 12; id++) {
        store.addRoom(id, areaId as number);
        store.setRoomCoordinates(id, id, id * 2, 0);
        store.setRoomIDbyHash(id, `hash-${id}`);
    }
    store.setRoomUserData(3, 'note', 'has user data');
    store.setRoomHidden(7, true);
    store.setCustomEnvColor(42, 10, 20, 30);
    store.setPlayerRoom(5);
    return writeMapToBuffer(store.toMudletMapForSave());
}

/** Everything about a loaded store that either path must agree on. */
function snapshot(store: MapStore) {
    const map = store.toMudletMapForSave();
    return {
        rooms: map.rooms,
        areas: map.areas,
        areaNames: map.areaNames,
        labels: map.labels,
        customEnvColors: map.mCustomEnvColors,
        hashIndex: map.mpRoomDbHashToRoomId,
        roomIdHash: map.mRoomIdHash,
        playerRoom: store.getPlayerRoom(),
        hidden: [...Array(13).keys()].filter(id => store.isRoomHidden(id)),
        // Fresh ids must not collide with anything the binary carried — the
        // cursor is bumped per room during ingest, so a streamed load that
        // dropped that would silently overwrite room 12 later.
        nextRoomId: store.createRoomID(),
    };
}

/** Drive the three-phase load the way the worker client does, in batches. */
function loadStreamed(bytes: Uint8Array, batchSize: number): MapStore {
    const store = new MapStore();
    store.profileName = 'tester';
    let batch: [number, MudletRoom][] = [];
    streamRooms(
        Buffer.from(bytes),
        (id, room) => {
            batch.push([id, room]);
            if (batch.length >= batchSize) {
                store.ingestBinaryRooms(batch);
                batch = [];
            }
        },
        header => store.beginBinaryLoad(header),
    );
    if (batch.length > 0) store.ingestBinaryRooms(batch);
    store.endBinaryLoad();
    return store;
}

describe('MapStore streamed binary load', () => {
    const bytes = buildSourceMap();

    const eager = new MapStore();
    eager.profileName = 'tester';
    eager.loadFromBinary(readMapFromBuffer(Buffer.from(bytes)));

    it('lands the same state as an eager loadFromBinary', () => {
        expect(snapshot(loadStreamed(bytes, 5))).toEqual(snapshot(eager));
    });

    it('is insensitive to batch size', () => {
        // One room per message and one message for the lot must be equivalent —
        // nothing may depend on batch boundaries.
        expect(snapshot(loadStreamed(bytes, 1))).toEqual(snapshot(loadStreamed(bytes, 1000)));
    });

    it('attaches room hashes that only the header carries', () => {
        // streamRooms explicitly does not set room.hash; endBinaryLoad has to
        // recover it from mpRoomDbHashToRoomId or saving would drop the index.
        const streamed = loadStreamed(bytes, 5);
        expect(streamed.getRoomHashByID(4)).toBe('hash-4');
        expect(streamed.getRoomIDbyHash('hash-4')).toBe(4);
    });

    it('restores the hidden-room side table and the player position', () => {
        const streamed = loadStreamed(bytes, 5);
        expect(streamed.isRoomHidden(7)).toBe(true);
        expect(streamed.isRoomHidden(6)).toBe(false);
        // The fallback userData key must be consumed, not left on the room.
        expect(streamed.getRoomUserData(7, 'system.fallback_hidden')).toBeFalsy();
        expect(streamed.getPlayerRoom()).toBe(5);
    });

    it('notifies subscribers once, after the load completes', async () => {
        const store = new MapStore();
        store.profileName = 'tester';
        let notifications = 0;
        let roomsAtFirstNotify = -1;
        store.subscribe(() => {
            notifications++;
            if (roomsAtFirstNotify < 0) roomsAtFirstNotify = Object.keys(store.getRooms()).length;
        });
        const map = readMapFromBuffer(Buffer.from(bytes));
        store.beginBinaryLoad(map);
        store.ingestBinaryRooms(Object.entries(map.rooms).map(([k, r]) => [Number(k), r] as const));
        // Notification is microtask-coalesced; a flush here would still see
        // nothing, because the room phase deliberately doesn't schedule one.
        await Promise.resolve();
        expect(notifications).toBe(0);
        store.endBinaryLoad();
        await Promise.resolve();
        // Subscribers never observe a partially-populated store: the first (and
        // only) notification carries the complete map.
        expect(notifications).toBe(1);
        expect(roomsAtFirstNotify).toBe(12);
    });
});
