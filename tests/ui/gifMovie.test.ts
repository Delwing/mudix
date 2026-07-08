import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decodeGif, sniffDecodableImage, MoviePlayer, type DecodedGif } from '../../src/ui/labels/gifMovie';
import { buildGif } from '../gifFixture';

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const GREEN: [number, number, number] = [0, 255, 0];

function px(frame: { pixels: Uint8ClampedArray }, i: number): number[] {
    return [...frame.pixels.subarray(i * 4, i * 4 + 4)];
}

describe('decodeGif', () => {
    it('decodes a single-frame GIF (dimensions, palette colors, default delay)', () => {
        const gif = decodeGif(buildGif({
            width: 2, height: 2,
            palette: [RED, BLUE],
            frames: [{ width: 2, height: 2, indices: [0, 1, 1, 0] }],
        }));
        expect(gif.width).toBe(2);
        expect(gif.height).toBe(2);
        expect(gif.frames).toHaveLength(1);
        expect(gif.plays).toBe(1); // no NETSCAPE extension → plays once
        expect(px(gif.frames[0], 0)).toEqual([255, 0, 0, 255]);
        expect(px(gif.frames[0], 1)).toEqual([0, 0, 255, 255]);
        expect(px(gif.frames[0], 2)).toEqual([0, 0, 255, 255]);
        expect(px(gif.frames[0], 3)).toEqual([255, 0, 0, 255]);
        // No GCE → 0cs delay, bumped to the browser-conventional 100ms.
        expect(gif.frames[0].delayMs).toBe(100);
    });

    it('composites a partial second frame over the first (disposal: keep)', () => {
        const gif = decodeGif(buildGif({
            width: 2, height: 1,
            palette: [RED, BLUE, GREEN],
            frames: [
                { width: 2, height: 1, indices: [0, 0], delayCs: 5, disposal: 1 },
                // 1×1 sub-image at (1,0) painting green.
                { width: 1, height: 1, left: 1, indices: [2], delayCs: 50, disposal: 1 },
            ],
        }));
        expect(gif.frames).toHaveLength(2);
        expect(gif.frames[0].delayMs).toBe(50);
        expect(gif.frames[1].delayMs).toBe(500);
        expect(px(gif.frames[1], 0)).toEqual([255, 0, 0, 255]); // kept from frame 1
        expect(px(gif.frames[1], 1)).toEqual([0, 255, 0, 255]); // painted by frame 2
    });

    it('skips transparent pixels and honors disposal 2 (restore to background)', () => {
        const gif = decodeGif(buildGif({
            width: 2, height: 1,
            palette: [RED, BLUE, GREEN, [0, 0, 0]],
            frames: [
                { width: 2, height: 1, indices: [0, 0], disposal: 2 },
                // After frame 1 is disposed the canvas is transparent again;
                // index 3 is transparent here, so only pixel 0 gets painted.
                { width: 2, height: 1, indices: [1, 3], transparentIndex: 3 },
            ],
        }));
        expect(px(gif.frames[1], 0)).toEqual([0, 0, 255, 255]);
        expect(px(gif.frames[1], 1)).toEqual([0, 0, 0, 0]); // fully transparent
    });

    it('honors disposal 3 (restore to previous)', () => {
        const gif = decodeGif(buildGif({
            width: 2, height: 1,
            palette: [RED, BLUE, GREEN],
            frames: [
                { width: 2, height: 1, indices: [0, 0], disposal: 1 },
                // Overwrites pixel 0 with blue, then reverts on disposal.
                { width: 1, height: 1, indices: [1], disposal: 3 },
                { width: 1, height: 1, left: 1, indices: [2] },
            ],
        }));
        expect(px(gif.frames[1], 0)).toEqual([0, 0, 255, 255]);
        expect(px(gif.frames[2], 0)).toEqual([255, 0, 0, 255]); // restored
        expect(px(gif.frames[2], 1)).toEqual([0, 255, 0, 255]);
    });

    it('reads the NETSCAPE loop extension', () => {
        const base = {
            width: 1, height: 1,
            palette: [RED, BLUE] as Array<[number, number, number]>,
            frames: [{ width: 1, height: 1, indices: [0] }],
        };
        expect(decodeGif(buildGif({ ...base, loopCount: 0 })).plays).toBe(Infinity);
        expect(decodeGif(buildGif({ ...base, loopCount: 2 })).plays).toBe(3);
        expect(decodeGif(buildGif(base)).plays).toBe(1);
    });

    it('deinterlaces row data', () => {
        // 1×4 column; interlace storage order for h=4 is rows 0, 2, 1, 3.
        const gif = decodeGif(buildGif({
            width: 1, height: 4,
            palette: [RED, BLUE, GREEN, [7, 7, 7]],
            frames: [{ width: 1, height: 4, interlaced: true, indices: [0, 2, 1, 3] }],
        }));
        expect(px(gif.frames[0], 0)).toEqual([255, 0, 0, 255]);
        expect(px(gif.frames[0], 1)).toEqual([0, 0, 255, 255]);
        expect(px(gif.frames[0], 2)).toEqual([0, 255, 0, 255]);
        expect(px(gif.frames[0], 3)).toEqual([7, 7, 7, 255]);
    });

    it('decodes a real LZW stream with dictionary growth (KwKwK case)', () => {
        // Hand-packed codes for a 2×2 all-index-0 image, minCodeSize 2:
        // CLEAR(4) 0 6 0 EOI(5) — code 6 is the KwKwK case ("00"), and the
        // dictionary hits 8 entries so EOI is read at 4 bits.
        const header = [
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
            2, 0, 2, 0, 0x80, 0, 0,             // 2×2, GCT of 2 entries
            255, 0, 0, 0, 0, 255,               // red, blue
            0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0,    // image descriptor 2×2
            2,                                  // min code size
            2, 132, 81,                         // one 2-byte data sub-block
            0, 0x3b,                            // terminator + trailer
        ];
        const gif = decodeGif(new Uint8Array(header));
        expect(gif.frames).toHaveLength(1);
        for (let i = 0; i < 4; i++) expect(px(gif.frames[0], i)).toEqual([255, 0, 0, 255]);
    });

    it('rejects non-GIF data and GIFs without frames', () => {
        expect(() => decodeGif(new Uint8Array([1, 2, 3]))).toThrow(/not a GIF/);
        const noFrames = buildGif({
            width: 1, height: 1, palette: [RED, BLUE],
            frames: [{ width: 1, height: 1, indices: [0] }],
        }).subarray(0, 19); // truncate before the image descriptor
        expect(() => decodeGif(noFrames)).toThrow(/no image frames/);
    });
});

describe('MoviePlayer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function makeGif(frameCount: number, plays = Infinity, delayMs = 100): DecodedGif {
        return {
            width: 1, height: 1, plays,
            frames: Array.from({ length: frameCount }, () => ({
                pixels: new Uint8ClampedArray(4),
                delayMs,
            })),
        };
    }

    it('advances frames on the recorded delays and loops', () => {
        const p = new MoviePlayer(makeGif(3));
        p.start();
        expect(p.isPlaying).toBe(true);
        expect(p.currentFrame).toBe(0);
        vi.advanceTimersByTime(100);
        expect(p.currentFrame).toBe(1);
        vi.advanceTimersByTime(200);
        expect(p.currentFrame).toBe(0); // wrapped
    });

    it('pause freezes the current frame; start resumes', () => {
        const p = new MoviePlayer(makeGif(3));
        p.start();
        vi.advanceTimersByTime(100);
        p.pause();
        expect(p.isPlaying).toBe(false);
        vi.advanceTimersByTime(500);
        expect(p.currentFrame).toBe(1);
        p.start();
        vi.advanceTimersByTime(100);
        expect(p.currentFrame).toBe(2);
    });

    it('jumpToFrame is 0-based and bounds-checked', () => {
        const p = new MoviePlayer(makeGif(3));
        expect(p.jumpToFrame(2)).toBe(true);
        expect(p.currentFrame).toBe(2);
        expect(p.jumpToFrame(3)).toBe(false);
        expect(p.jumpToFrame(-1)).toBe(false);
        expect(p.jumpToFrame(1.5)).toBe(false);
        expect(p.currentFrame).toBe(2);
    });

    it('setSpeed rescales the frame delay (200% → half the wait)', () => {
        const p = new MoviePlayer(makeGif(3));
        p.start();
        p.setSpeed(200);
        vi.advanceTimersByTime(50);
        expect(p.currentFrame).toBe(1);
        expect(p.setSpeed(NaN)).toBe(false);
        // Speed ≤ 0 halts advancing without pausing (QMovie-like).
        p.setSpeed(0);
        vi.advanceTimersByTime(1000);
        expect(p.currentFrame).toBe(1);
        expect(p.isPlaying).toBe(true);
    });

    it('a non-looping movie stops on its last frame and start() replays it', () => {
        const p = new MoviePlayer(makeGif(2, 1));
        p.start();
        vi.advanceTimersByTime(100);
        expect(p.currentFrame).toBe(1);
        vi.advanceTimersByTime(100); // last frame's hold elapses → finished
        expect(p.isPlaying).toBe(false);
        expect(p.currentFrame).toBe(1);
        p.start(); // QMovie::start restarts a finished movie
        expect(p.currentFrame).toBe(0);
        vi.advanceTimersByTime(100);
        expect(p.currentFrame).toBe(1);
    });

    it('stop() clears the timer so nothing ticks after label teardown', () => {
        const p = new MoviePlayer(makeGif(3));
        p.start();
        p.stop();
        vi.advanceTimersByTime(1000);
        expect(p.currentFrame).toBe(0);
        expect(p.isPlaying).toBe(false);
    });

    // The ImageDecoder path installs a frameless player synchronously and
    // delivers frames later — the player must honor the start/pause intent
    // expressed in between.
    describe('pending player (async ImageDecoder path)', () => {
        it('starts playback on resolveFrames when start() was called before', () => {
            const p = MoviePlayer.pending(1, 1);
            expect(p.frameCount).toBe(0);
            p.start();
            expect(p.isPlaying).toBe(false); // nothing to play yet
            expect(p.jumpToFrame(0)).toBe(false);
            p.resolveFrames(makeGif(3));
            expect(p.isPlaying).toBe(true);
            vi.advanceTimersByTime(100);
            expect(p.currentFrame).toBe(1);
        });

        it('stays paused when pause()/stop() followed start()', () => {
            const paused = MoviePlayer.pending(1, 1);
            paused.start();
            paused.pause();
            paused.resolveFrames(makeGif(3));
            expect(paused.isPlaying).toBe(false);

            const stopped = MoviePlayer.pending(1, 1);
            stopped.start();
            stopped.stop();
            stopped.resolveFrames(makeGif(3));
            expect(stopped.isPlaying).toBe(false);
            vi.advanceTimersByTime(1000);
            expect(stopped.currentFrame).toBe(0);
        });

        it('keeps speed/scale settings made while pending', () => {
            const p = MoviePlayer.pending(1, 1);
            expect(p.setSpeed(200)).toBe(true);
            p.start();
            p.resolveFrames(makeGif(3));
            vi.advanceTimersByTime(50); // 100ms frame at 200% speed
            expect(p.currentFrame).toBe(1);
        });
    });
});

describe('sniffDecodableImage', () => {
    it('recognizes PNG with header dimensions', () => {
        // PNG signature + IHDR: width 5, height 7 (big-endian).
        const png = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
            0, 0, 0, 5, 0, 0, 0, 7,
            8, 6, 0, 0, 0,
        ]);
        expect(sniffDecodableImage(png)).toEqual({ mime: 'image/png', width: 5, height: 7 });
    });

    it('recognizes WebP (VP8X) with canvas dimensions', () => {
        // RIFF....WEBP VP8X: flags 0x02 (animation), canvas 16×9 (stored -1, LE24).
        const webp = new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 30, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
            0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0,
            0x02, 0, 0, 0,
            15, 0, 0, 8, 0, 0,
        ]);
        expect(sniffDecodableImage(webp)).toEqual({ mime: 'image/webp', width: 16, height: 9 });
    });

    it('rejects GIFs (they use the bundled decoder) and garbage', () => {
        const gif = buildGif({
            width: 1, height: 1, palette: [[255, 0, 0], [0, 0, 255]],
            frames: [{ width: 1, height: 1, indices: [0] }],
        });
        expect(sniffDecodableImage(gif)).toBeNull();
        expect(sniffDecodableImage(new Uint8Array(32))).toBeNull();
    });
});
