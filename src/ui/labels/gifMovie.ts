// Browser-side replacement for the QMovie machinery behind Mudlet's
// setMovie/startMovie/pauseMovie/setMovieFrame/setMovieSpeed/scaleMovie.
// A `<img>` can display an animated GIF but exposes no playback control, so we
// decode the GIF ourselves (it's a simple LZW format) into composited RGBA
// frames and drive playback onto a <canvas> with our own timer — which gives
// QMovie-parity pause/resume, frame jumps, and speed scaling. Decoding is pure
// (no DOM), so it runs in tests and off the main render path; a 200×200
// 50-frame GIF is ~8 MB of frames, comparable to QMovie's CacheAll mode.
//
// Qt's QMovie also animates WebP (and shows static images); for those the
// pure-JS decoder doesn't apply, so non-GIF inputs go through the WebCodecs
// ImageDecoder (Chromium/Safari) into the same DecodedGif shape — see
// sniffDecodableImage / decodeAnimatedImage and MoviePlayer.pending.

import { parseImageSize } from '../../scripting/lua/imageSize';

export interface GifFrame {
    /** Full-canvas RGBA pixels, already composited (disposal applied).
     *  Explicitly ArrayBuffer-backed so it satisfies the ImageData ctor. */
    pixels: Uint8ClampedArray<ArrayBuffer>;
    /** Frame hold time in ms. Sub-2cs delays are bumped to 100ms, matching the
     *  de-facto browser behaviour for degenerate "0 delay" GIFs. */
    delayMs: number;
}

export interface DecodedGif {
    width: number;
    height: number;
    /** Total number of times the animation plays; Infinity for looping GIFs
     *  (NETSCAPE2.0 loop count 0). No extension → plays once, like QMovie. */
    plays: number;
    frames: GifFrame[];
}

const INTERLACE_PASSES: ReadonlyArray<readonly [number, number]> = [[0, 8], [4, 8], [2, 4], [1, 2]];

/** Decode a GIF87a/GIF89a file into composited full frames. Throws on data
 *  that isn't a GIF or is structurally broken; tolerates a truncated tail the
 *  way browsers do (keeps the frames decoded so far). */
export function decodeGif(bytes: Uint8Array): DecodedGif {
    if (bytes.length < 13
        || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) {
        throw new Error('gif: not a GIF file');
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint16(6, true);
    const height = dv.getUint16(8, true);
    if (width === 0 || height === 0) throw new Error('gif: zero-sized image');
    const packed = bytes[10];
    let pos = 13;

    let globalPalette: Uint8Array | null = null;
    if (packed & 0x80) {
        const size = 3 * (1 << ((packed & 0x07) + 1));
        globalPalette = bytes.subarray(pos, pos + size);
        pos += size;
    }

    const frames: GifFrame[] = [];
    // Composition buffer — starts fully transparent, mutated frame by frame.
    const canvas = new Uint8ClampedArray(width * height * 4);
    let plays = 1;
    let gce: { delayCs: number; disposal: number; transparentIndex: number } | null = null;

    const readSubBlocks = (): Uint8Array => {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (pos < bytes.length) {
            const len = bytes[pos++];
            if (len === 0) break;
            chunks.push(bytes.subarray(pos, pos + len));
            total += len;
            pos += len;
        }
        const out = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) { out.set(c, o); o += c.length; }
        return out;
    };
    const skipSubBlocks = (): void => {
        while (pos < bytes.length) {
            const len = bytes[pos++];
            if (len === 0) break;
            pos += len;
        }
    };

    decode:
    while (pos < bytes.length) {
        const block = bytes[pos++];
        switch (block) {
            case 0x3b: // trailer
                break decode;
            case 0x21: { // extension
                const label = bytes[pos++];
                if (label === 0xf9) { // graphic control
                    const len = bytes[pos++]; // spec: 4
                    const flags = bytes[pos];
                    gce = {
                        disposal: (flags >> 2) & 0x07,
                        delayCs: dv.getUint16(pos + 1, true),
                        transparentIndex: (flags & 0x01) ? bytes[pos + 3] : -1,
                    };
                    pos += len;
                    if (bytes[pos] === 0) pos++; // terminator
                } else if (label === 0xff) { // application
                    const len = bytes[pos];
                    const app = String.fromCharCode(...bytes.subarray(pos + 1, pos + 1 + len));
                    pos += 1 + len;
                    const data = readSubBlocks();
                    // NETSCAPE2.0 / ANIMEXTS1.0 loop block: [1, lo, hi].
                    if ((app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0') && data.length >= 3 && data[0] === 1) {
                        const count = data[1] | (data[2] << 8);
                        // Browsers play the animation loop-count + 1 times; 0 = forever.
                        plays = count === 0 ? Infinity : count + 1;
                    }
                } else { // comment / plain text / unknown — skip
                    skipSubBlocks();
                }
                break;
            }
            case 0x2c: { // image descriptor
                if (pos + 9 > bytes.length) break decode;
                const left = dv.getUint16(pos, true);
                const top = dv.getUint16(pos + 2, true);
                const w = dv.getUint16(pos + 4, true);
                const h = dv.getUint16(pos + 6, true);
                const iPacked = bytes[pos + 8];
                pos += 9;
                let palette = globalPalette;
                if (iPacked & 0x80) {
                    const size = 3 * (1 << ((iPacked & 0x07) + 1));
                    palette = bytes.subarray(pos, pos + size);
                    pos += size;
                }
                if (!palette) throw new Error('gif: image without a color table');
                const minCodeSize = bytes[pos++];
                let indices = lzwDecode(minCodeSize, readSubBlocks(), w * h);
                if (iPacked & 0x40) indices = deinterlace(indices, w, h);

                const disposal = gce?.disposal ?? 0;
                const transparent = gce?.transparentIndex ?? -1;
                // Disposal 3: after showing this frame, the canvas reverts to
                // what it was before the frame was drawn.
                const snapshot = disposal === 3 ? canvas.slice() : null;

                // Paint the sub-image into the composition buffer, clamped to
                // the logical screen, skipping the transparent index.
                const maxY = Math.min(h, height - top);
                const maxX = Math.min(w, width - left);
                for (let y = 0; y < maxY; y++) {
                    const srcRow = y * w;
                    const dstRow = ((top + y) * width + left) * 4;
                    for (let x = 0; x < maxX; x++) {
                        const idx = indices[srcRow + x];
                        if (idx === transparent) continue;
                        const p = idx * 3;
                        const d = dstRow + x * 4;
                        canvas[d] = palette[p];
                        canvas[d + 1] = palette[p + 1];
                        canvas[d + 2] = palette[p + 2];
                        canvas[d + 3] = 255;
                    }
                }

                const delayCs = gce?.delayCs ?? 0;
                frames.push({
                    pixels: canvas.slice(),
                    delayMs: delayCs < 2 ? 100 : delayCs * 10,
                });

                if (disposal === 2) {
                    // Restore to background — rendered as transparent (what
                    // browsers and QMovie effectively do), scoped to the rect.
                    for (let y = 0; y < maxY; y++) {
                        const d = ((top + y) * width + left) * 4;
                        canvas.fill(0, d, d + maxX * 4);
                    }
                } else if (snapshot) {
                    canvas.set(snapshot);
                }
                gce = null;
                break;
            }
            default:
                // Unknown block — the stream is unwalkable from here.
                break decode;
        }
    }

    if (frames.length === 0) throw new Error('gif: no image frames');
    return { width, height, plays, frames };
}

/** GIF-flavoured LZW: variable code size (min+1 .. 12 bits), LSB-first bit
 *  packing, in-band clear/end-of-information codes. */
function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
    const out = new Uint8Array(pixelCount);
    if (minCodeSize < 1 || minCodeSize > 11) return out;
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const MAX = 4096;
    const prefix = new Int32Array(MAX);
    const suffix = new Uint8Array(MAX);
    const stack = new Uint8Array(MAX);

    let codeSize = minCodeSize + 1;
    let dictSize = eoiCode + 1;
    let prev = -1;
    let first = 0;
    let outPos = 0;
    let bitPos = 0;
    const totalBits = data.length * 8;

    while (outPos < pixelCount) {
        if (bitPos + codeSize > totalBits) break; // truncated stream
        // Read `codeSize` bits, LSB first.
        let code = 0;
        for (let i = 0; i < codeSize; i++, bitPos++) {
            code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
        }

        if (code === clearCode) {
            codeSize = minCodeSize + 1;
            dictSize = eoiCode + 1;
            prev = -1;
            continue;
        }
        if (code === eoiCode) break;

        let cur = code;
        let sp = 0;
        if (cur >= dictSize) {
            // Only the KwKwK case (code === dictSize) is legal.
            if (prev < 0 || cur > dictSize) break;
            stack[sp++] = first;
            cur = prev;
        }
        while (cur >= clearCode) {
            stack[sp++] = suffix[cur];
            cur = prefix[cur];
        }
        first = cur;
        stack[sp++] = cur;

        if (prev >= 0 && dictSize < MAX) {
            prefix[dictSize] = prev;
            suffix[dictSize] = first;
            dictSize++;
            if (dictSize === (1 << codeSize) && codeSize < 12) codeSize++;
        }
        prev = code;

        while (sp > 0 && outPos < pixelCount) out[outPos++] = stack[--sp];
    }
    return out;
}

/** Reorder interlaced row data (4-pass: rows 0/8, 4/8, 2/4, 1/2) to sequential. */
function deinterlace(indices: Uint8Array, w: number, h: number): Uint8Array {
    const out = new Uint8Array(indices.length);
    let src = 0;
    for (const [offset, step] of INTERLACE_PASSES) {
        for (let y = offset; y < h; y += step, src += w) {
            out.set(indices.subarray(src, src + w), y * w);
        }
    }
    return out;
}

/** How the movie canvas is sized inside its label — mirrors QMovie/QLabel:
 *  'none' shows the GIF at native size; 'auto' tracks the label size (CSS
 *  100%, so a label resize rescales for free — Mudlet's autoscale reconnect);
 *  'fixed' is scaleMovie(name, false): scaled once to the size at call time. */
export type MovieScale =
    | { mode: 'none' }
    | { mode: 'auto' }
    | { mode: 'fixed'; width: number; height: number };

/**
 * Playback controller for one decoded GIF on one label. The React layer
 * attaches/detaches the actual <canvas>; the player keeps ticking regardless
 * (QMovie also runs while hidden) and repaints the current frame on attach.
 */
export class MoviePlayer {
    /** Consumed by the label renderer; set via LabelManager.setMovieScale so
     *  the overlay re-renders when it changes. */
    scale: MovieScale = { mode: 'none' };

    private _gif: DecodedGif;
    private canvas: HTMLCanvasElement | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private frame = 0;
    private speedPct = 100;
    private playing = false;
    /** start()/pause() intent, remembered separately from `playing` so a
     *  pending player (frames still decoding) knows whether to begin playback
     *  when resolveFrames delivers them. */
    private wantsPlaying = false;
    private playsLeft: number;

    constructor(gif: DecodedGif) {
        this._gif = gif;
        this.playsLeft = gif.plays;
    }

    /** A player whose frames arrive later via {@link resolveFrames} — used for
     *  the async ImageDecoder path (animated WebP / APNG) so setMovie can
     *  install the movie synchronously; dimensions come from the file header. */
    static pending(width: number, height: number): MoviePlayer {
        return new MoviePlayer({ width, height, plays: 1, frames: [] });
    }

    get gif(): DecodedGif { return this._gif; }
    get frameCount(): number { return this.gif.frames.length; }
    get currentFrame(): number { return this.frame; }
    get isPlaying(): boolean { return this.playing; }
    get speed(): number { return this.speedPct; }

    /** Register the mounted canvas (null on unmount) and paint the current frame. */
    attach(canvas: HTMLCanvasElement | null): void {
        this.canvas = canvas;
        if (canvas) this.draw();
    }

    /** QMovie::start — begins/resumes playback; restarts when at the end. */
    start(): void {
        this.wantsPlaying = true;
        if (this.playing || this.frameCount === 0) return;
        if (this.playsLeft <= 0) { // finished earlier — restart from the top
            this.playsLeft = this.gif.plays;
            this.frame = 0;
            this.draw();
        }
        this.playing = true;
        this.schedule();
    }

    /** QMovie::setPaused(true) — stays on the current frame. */
    pause(): void {
        this.wantsPlaying = false;
        this.playing = false;
        this.clearTimer();
    }

    /** Deliver asynchronously-decoded frames to a {@link pending} player.
     *  Honors the intent expressed meanwhile: playback begins only if start()
     *  was called and no pause()/stop() followed it. */
    resolveFrames(gif: DecodedGif): void {
        this._gif = gif;
        this.playsLeft = gif.plays;
        this.frame = 0;
        this.draw();
        if (this.wantsPlaying && !this.playing) {
            this.playing = true;
            this.schedule();
        }
    }

    /** Full teardown when the label goes away or the movie is replaced. */
    stop(): void {
        this.pause();
        this.canvas = null;
    }

    /** QMovie::jumpToFrame — 0-based; false when the frame doesn't exist. */
    jumpToFrame(n: number): boolean {
        if (!Number.isInteger(n) || n < 0 || n >= this.frameCount) return false;
        this.frame = n;
        this.draw();
        if (this.playing) { this.clearTimer(); this.schedule(); }
        return true;
    }

    /** QMovie::setSpeed — percent, 100 = recorded speed. <= 0 halts advancing
     *  (paused-in-place) until a positive speed is set again. */
    setSpeed(percent: number): boolean {
        if (!Number.isFinite(percent)) return false;
        this.speedPct = percent;
        if (this.playing) { this.clearTimer(); this.schedule(); }
        return true;
    }

    private schedule(): void {
        if (this.timer !== null || this.frameCount <= 1 || this.speedPct <= 0) return;
        const delay = this.gif.frames[this.frame].delayMs * (100 / this.speedPct);
        this.timer = setTimeout(() => {
            this.timer = null;
            if (!this.playing) return;
            if (this.frame + 1 >= this.frameCount) {
                this.playsLeft--;
                if (this.playsLeft <= 0) { this.playing = false; return; }
                this.frame = 0;
            } else {
                this.frame++;
            }
            this.draw();
            this.schedule();
        }, delay);
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private draw(): void {
        const ctx = this.canvas?.getContext?.('2d');
        const f = this.gif.frames[this.frame];
        if (!ctx || !f) return;
        // ImageData wraps the frame buffer without copying.
        ctx.putImageData(new ImageData(f.pixels, this.gif.width, this.gif.height), 0, 0);
    }
}

// ── Non-GIF formats via WebCodecs ImageDecoder ──────────────────────────────
// Minimal structural types for the WebCodecs ImageDecoder API — not yet in the
// project's TS DOM lib. Kept local; nothing else should depend on them.

interface VideoFrameLike {
    displayWidth: number;
    displayHeight: number;
    /** Frame duration in MICROseconds; null for single images. */
    duration: number | null;
    close(): void;
}

interface ImageDecoderLike {
    tracks: {
        ready: Promise<void>;
        selectedTrack: { frameCount: number; repetitionCount: number } | null;
    };
    decode(opts: { frameIndex: number }): Promise<{ image: VideoFrameLike }>;
    close(): void;
}

type ImageDecoderCtor = new (init: { data: Uint8Array<ArrayBufferLike>; type: string }) => ImageDecoderLike;

function getImageDecoder(): ImageDecoderCtor | null {
    return (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder ?? null;
}

/** Whether the async decode path (animated WebP / APNG) exists in this
 *  browser. Firefox lacks ImageDecoder as of 2026 — GIFs still work there. */
export function supportsImageDecoder(): boolean {
    return getImageDecoder() !== null;
}

/** Identify non-GIF bytes the ImageDecoder path accepts for setMovie:
 *  WebP (animated or static) and PNG (APNG or static). Returns the MIME type
 *  and the header-derived dimensions a pending player needs; null otherwise. */
export function sniffDecodableImage(
    bytes: Uint8Array,
): { mime: 'image/png' | 'image/webp'; width: number; height: number } | null {
    const size = parseImageSize(bytes);
    if (!size || size.width <= 0 || size.height <= 0) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { mime: 'image/png', ...size };
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return { mime: 'image/webp', ...size };
    return null;
}

/** Decode WebP/APNG through ImageDecoder into the DecodedGif shape. Each
 *  decoded VideoFrame is already fully composited (the decoder applies
 *  blending/disposal), so frames just need rasterizing to RGBA — done by
 *  drawing onto an OffscreenCanvas (available wherever ImageDecoder is). */
export async function decodeAnimatedImage(bytes: Uint8Array, mime: string): Promise<DecodedGif> {
    const ImageDecoder = getImageDecoder();
    if (!ImageDecoder) throw new Error('movie: ImageDecoder is not available in this browser');
    const decoder = new ImageDecoder({ data: bytes, type: mime });
    try {
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (!track || track.frameCount === 0) throw new Error('movie: no decodable frames');

        let width = 0;
        let height = 0;
        let ctx: OffscreenCanvasRenderingContext2D | null = null;
        const frames: GifFrame[] = [];
        for (let i = 0; i < track.frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            if (!ctx) {
                width = image.displayWidth;
                height = image.displayHeight;
                ctx = new OffscreenCanvas(width, height)
                    .getContext('2d', { willReadFrequently: true });
                if (!ctx) { image.close(); throw new Error('movie: no 2d canvas context'); }
            }
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(image as unknown as CanvasImageSource, 0, 0);
            const pixels = ctx.getImageData(0, 0, width, height).data;
            // duration is µs; unlike GIF there's no legacy 100ms bump — honor
            // the recorded delay with a small floor so 0 can't busy-loop.
            const delayMs = Math.max((image.duration ?? 0) / 1000, 10);
            image.close();
            frames.push({ pixels, delayMs });
        }

        const reps = track.repetitionCount; // repetitions AFTER the first play
        const plays = reps === Infinity ? Infinity : (Number.isFinite(reps) ? reps + 1 : 1);
        return { width, height, plays, frames };
    } finally {
        decoder.close();
    }
}
