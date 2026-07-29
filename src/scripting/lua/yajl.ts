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

// Handing a decoded object graph back to Lua makes wasmoon walk it node by node
// through its proxy layer. That is fine for a GMCP packet and pathological for a
// map database: measured on f2ce-tools' 8.1 MB galaxy_brief.json, JSON.parse plus
// the remap below cost 45ms while the marshalling cost 280 SECONDS — 99.98% of
// the total, and the whole of the UI freeze this decoder used to cause.
//
// So the fast path never returns a graph. It emits the value as Lua
// table-constructor source and lets Lua's own C parser build the tables, which
// crosses the bridge as one flat ASCII string instead of hundreds of thousands
// of proxy operations. See __yajl_parse_src__ below; Yajl.lua loadstring()s the
// result and falls back to __yajl_parse__ whenever this returns nil.

/** Printable ASCII excluding `"` (0x22) and `\` (0x5C) — emittable verbatim. */
const LUA_SAFE_ASCII = /^[\x20\x21\x23-\x5B\x5D-\x7E]*$/;

const utf8 = new TextEncoder();

/**
 * Append `s` as a Lua string literal. Non-ASCII is emitted as three-digit
 * decimal escapes of its UTF-8 bytes: Lua strings are byte strings, and a
 * pure-ASCII chunk also sidesteps the UTF-8 mangling the wasmoon string bridge
 * applies to high bytes (the same hazard VFS.lua armors around). Escapes are
 * always padded to three digits so a following literal digit can't be absorbed
 * into the escape.
 */
function pushLuaString(s: string, out: string[]): void {
    if (LUA_SAFE_ASCII.test(s)) {
        out.push('"', s, '"');
        return;
    }
    const bytes = utf8.encode(s);
    let lit = '"';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 0x22) lit += '\\"';
        else if (b === 0x5C) lit += '\\\\';
        else if (b >= 0x20 && b <= 0x7E) lit += String.fromCharCode(b);
        else lit += '\\' + String(b).padStart(3, '0');
    }
    out.push(lit, '"');
}

// Lua's parser caps nested constructors (LUAI_MAXCCALLS, 200 by default), so a
// pathologically deep document must not be emitted as source. Well under the
// limit to leave room for the wrapper.
const MAX_EMIT_DEPTH = 150;

class TooDeepError extends Error {}

function pushLuaValue(v: unknown, out: string[], depth: number): void {
    if (depth > MAX_EMIT_DEPTH) throw new TooDeepError();
    if (v === null) { out.push('N'); return; }
    switch (typeof v) {
        case 'string':  pushLuaString(v, out); return;
        // JSON can't carry NaN/Infinity, but a hand-built value could; Lua source
        // has no literal for them, so clamp rather than emit invalid syntax.
        case 'number':  out.push(Number.isFinite(v) ? String(v) : '0'); return;
        case 'boolean': out.push(v ? 'true' : 'false'); return;
    }
    if (Array.isArray(v)) {
        // A plain constructor is already 1-indexed, which is exactly the shape
        // the sparse-array dance in `transform` exists to produce.
        out.push('{');
        for (let i = 0; i < v.length; i++) {
            if (i > 0) out.push(',');
            pushLuaValue(v[i], out, depth + 1);
        }
        out.push('}');
        return;
    }
    if (typeof v === 'object') {
        out.push('{');
        let first = true;
        for (const k of Object.keys(v as object)) {
            if (!first) out.push(',');
            first = false;
            // Bracketed keys: JSON keys can be reserved words, digits or empty,
            // none of which are valid bare Lua identifiers.
            out.push('[');
            pushLuaString(k, out);
            out.push(']=');
            pushLuaValue((v as Record<string, unknown>)[k], out, depth + 1);
        }
        out.push('}');
        return;
    }
    out.push('nil');
}

/**
 * Serialise a JSON-decoded value as a Lua chunk returning it. The chunk takes
 * the null sentinel as its vararg so nulls survive without a global lookup.
 * Returns null when the value nests too deeply to express as source.
 */
export function luaChunkForValue(v: unknown): string | null {
    const out: string[] = ['local N=... return '];
    try {
        pushLuaValue(v, out, 0);
    } catch (err) {
        if (err instanceof TooDeepError) return null;
        throw err;
    }
    return out.join('');
}

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

    // Fast path: hand Lua source back, not a graph. Null on anything this can't
    // express, so Yajl.lua can fall through to the slow path below.
    lua.global.set('__yajl_parse_src__', (s: unknown): string | null => {
        try {
            return luaChunkForValue(JSON.parse(String(s ?? 'null')));
        } catch {
            return null;
        }
    });

    lua.global.set('__yajl_parse__', (s: unknown): unknown => {
        return transform(JSON.parse(String(s ?? 'null')));
    });

    return { transform };
}
