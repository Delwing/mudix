// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { readMapFromBuffer, writeMapToBuffer } from 'mudlet-map-binary-reader';
import { MapStore } from '../../src/map/MapStore';

// mudlet-map-binary-reader 1.1.0 added read-only support for legacy map
// versions 16-19; its writer rejects those versions outright. MapStore is the
// only place that builds a MudletMap for writing, so it must always stamp the
// current writable format (20) regardless of what version the in-memory data
// originated from — otherwise a map read from a v16 file could never be saved.
describe('MapStore save version', () => {
    it('always emits writable format version 20', () => {
        const store = new MapStore();
        store.addRoom(1);
        expect(store.toMudletMapForSave().version).toBe(20);
        expect(store.toMudletMap().version).toBe(20);
    });

    it('round-trips a legacy v16 map back out as v20', () => {
        // Build a v20 map, then pretend it came off disk as v16 (the version int
        // a 1.1.0 reader would surface for a legacy file). Loading it and saving
        // must re-stamp 20 so writeMapToBuffer accepts it.
        const store = new MapStore();
        store.addRoom(1);
        store.addRoom(2);
        const legacy = store.toMudletMapForSave();
        legacy.version = 16;

        const reloaded = new MapStore();
        reloaded.loadFromBinary(legacy);
        const saved = reloaded.toMudletMapForSave();
        expect(saved.version).toBe(20);

        // The writer throws for legacy versions, so a successful encode + decode
        // is itself the assertion that the upgrade stuck.
        const bytes = writeMapToBuffer(saved);
        const parsed = readMapFromBuffer(Buffer.from(bytes));
        expect(parsed.version).toBe(20);
        expect(Object.keys(parsed.rooms).sort()).toEqual(['1', '2']);
    });
});
