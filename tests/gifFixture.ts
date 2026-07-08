// Programmatic GIF builder for the gifMovie tests — produces real, spec-valid
// GIF89a bytes so the decoder is exercised end-to-end without binary fixtures.
//
// The LZW encoder cheats for simplicity: it emits a CLEAR code before every
// literal, so the dictionary never grows and every code is a fixed
// (minCodeSize + 1)-bit literal. That is a perfectly legal stream (decoders
// must handle clears anywhere); the decoder's dictionary-growth paths are
// covered separately by a hand-packed stream in the test file.

export interface GifFrameSpec {
    /** Palette indices, row-major, width*height entries. */
    indices: number[];
    width: number;
    height: number;
    left?: number;
    top?: number;
    /** GIF delay in centiseconds (omit for no GCE delay → 0). */
    delayCs?: number;
    /** GIF disposal method (0 none, 1 keep, 2 restore-bg, 3 restore-prev). */
    disposal?: number;
    /** Palette index treated as transparent in this frame. */
    transparentIndex?: number;
    /** Store the pixel rows in interlaced order and set the interlace flag. */
    interlaced?: boolean;
}

export interface GifSpec {
    width: number;
    height: number;
    /** Global color table entries [r, g, b]; padded to a power of two ≥ 2. */
    palette: Array<[number, number, number]>;
    frames: GifFrameSpec[];
    /** NETSCAPE2.0 loop count (0 = forever). Omit for no loop extension. */
    loopCount?: number;
}

export function buildGif(spec: GifSpec): Uint8Array {
    const out: number[] = [];
    const u16 = (v: number) => { out.push(v & 0xff, (v >> 8) & 0xff); };

    // Pad the palette to a power of two (min 2 entries).
    let entries = 2;
    while (entries < spec.palette.length) entries *= 2;
    const sizeBits = Math.log2(entries) - 1;

    // Header + logical screen descriptor + GCT.
    out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
    u16(spec.width);
    u16(spec.height);
    out.push(0x80 | sizeBits, 0, 0); // GCT present, bg index 0, no aspect
    for (let i = 0; i < entries; i++) {
        const [r, g, b] = spec.palette[i] ?? [0, 0, 0];
        out.push(r, g, b);
    }

    if (spec.loopCount !== undefined) {
        out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)));
        out.push(3, 1, spec.loopCount & 0xff, (spec.loopCount >> 8) & 0xff, 0);
    }

    const minCodeSize = Math.max(2, Math.log2(entries));
    for (const f of spec.frames) {
        if (f.delayCs !== undefined || f.disposal !== undefined || f.transparentIndex !== undefined) {
            const transparent = f.transparentIndex !== undefined;
            const flags = ((f.disposal ?? 0) << 2) | (transparent ? 1 : 0);
            out.push(0x21, 0xf9, 4, flags);
            u16(f.delayCs ?? 0);
            out.push(transparent ? f.transparentIndex! : 0, 0);
        }
        out.push(0x2c);
        u16(f.left ?? 0);
        u16(f.top ?? 0);
        u16(f.width);
        u16(f.height);
        out.push(f.interlaced ? 0x40 : 0); // no LCT
        out.push(minCodeSize);
        const data = lzwEncodeLiterals(minCodeSize, f.indices);
        for (let i = 0; i < data.length; i += 255) {
            const chunk = data.slice(i, i + 255);
            out.push(chunk.length, ...chunk);
        }
        out.push(0); // block terminator
    }

    out.push(0x3b); // trailer
    return new Uint8Array(out);
}

/** Fixed-width LZW stream: CLEAR k1 CLEAR k2 … kn EOI (see module comment). */
function lzwEncodeLiterals(minCodeSize: number, indices: number[]): number[] {
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;
    const codeSize = minCodeSize + 1;
    const out: number[] = [];
    let cur = 0;
    let bits = 0;
    const emit = (code: number) => {
        cur |= code << bits;
        bits += codeSize;
        while (bits >= 8) {
            out.push(cur & 0xff);
            cur >>= 8;
            bits -= 8;
        }
    };
    emit(clear);
    for (const k of indices) {
        emit(k);
        emit(clear);
    }
    emit(eoi);
    if (bits > 0) out.push(cur & 0xff);
    return out;
}
