import type {Lua} from 'wasmoon-lua5.1';

// JSON ↔ Lua bridge for Mudlet's `yajl` module. The encoder lives in
// Yajl.lua; this file owns the decoder (JS-side JSON.parse + remap).
//
// Two conversion gotchas to keep in mind:
//   1. wasmoon pushes JS arrays as 0-indexed Lua tables (Object.keys preserves
//      "0","1",...). JSON arrays must come out 1-indexed so user code can do
//      arr[1]. We rebuild arrays as sparse JS arrays starting at index 1 — the
//      same trick LuaRuntime.setMatches uses.
//   2. JSON `null` would normally collapse to Lua nil, which deletes table
//      entries. Yajl.lua hands us a sentinel reference (`yajl.null`); we keep
//      it captured here and splice it back in for every null we encounter.
export type LuaValueTransform = (v: unknown) => unknown;

export function setupYajl(lua: Lua): { transform: LuaValueTransform } {
    let nullSentinel: unknown = null;

    lua.global.set('__yajl_set_null__', (s: unknown) => {
        nullSentinel = s;
    });

    const transform: LuaValueTransform = (v) => {
        if (v === null) return nullSentinel;
        if (Array.isArray(v)) {
            // Sparse array starting at index 1: wasmoon's pushTable sees an
            // Array, parses Object.keys numerically, and the resulting Lua
            // table is keyed 1..n.
            const out: unknown[] = [];
            for (let i = 0; i < v.length; i++) out[i + 1] = transform(v[i]);
            return out;
        }
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(v)) {
                out[k] = transform((v as Record<string, unknown>)[k]);
            }
            return out;
        }
        return v;
    };

    lua.global.set('__yajl_parse__', (s: unknown): unknown => {
        return transform(JSON.parse(String(s ?? 'null')));
    });

    return { transform };
}
