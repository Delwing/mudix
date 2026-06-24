import { describe, it, expect, beforeAll } from 'vitest';
import { SoundManager } from '../../src/ui/sound/SoundManager';

// Minimal fake Web Audio graph. SoundManager only touches a small slice of the
// API, so we stub exactly that surface and record every GainNode created so the
// test can read back the effective gain a source was given.
const createdGains: FakeGain[] = [];

class FakeGainParam {
    value = 0;
    setValueAtTime(v: number) { this.value = v; }
    linearRampToValueAtTime(v: number) { this.value = v; }
    cancelScheduledValues() { /* no-op */ }
}
class FakeGain {
    gain = new FakeGainParam();
    connect<T>(node: T): T { return node; }
}
class FakeSource {
    buffer: unknown = null;
    loop = false;
    onended: (() => void) | null = null;
    connect<T>(node: T): T { return node; }
    start() { /* no-op */ }
    stop() { /* no-op */ }
}
class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 44100;
    destination = {};
    createBufferSource() { return new FakeSource(); }
    createGain() { const g = new FakeGain(); createdGains.push(g); return g; }
    createBuffer(_ch: number, len: number, sr: number) {
        return { duration: len / sr, getChannelData: () => new Float32Array(len) };
    }
    decodeAudioData(_buf: ArrayBuffer) {
        return Promise.resolve({ duration: 1, numberOfChannels: 1 } as unknown as AudioBuffer);
    }
    resume() { return Promise.resolve(); }
}

/** Play a sound and return the GainNode SoundManager attached to it (the first
 *  gain created during this call — the keepalive gain, if any, comes after). */
async function playAndGetGain(mgr: SoundManager, opts: Parameters<SoundManager['playSound']>[0]) {
    createdGains.length = 0;
    await mgr.playSound(opts);
    return createdGains[0];
}

describe('SoundManager per-origin mute gates', () => {
    beforeAll(() => {
        (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    });

    function makeManager() {
        const mgr = new SoundManager();
        // Loader just has to return some bytes; the fake decoder ignores them.
        mgr.setLoader(async () => new ArrayBuffer(8));
        return mgr;
    }

    it('plays at full gain by default and reports both origins audible', async () => {
        const mgr = makeManager();
        expect(mgr.isOriginMuted('api')).toBe(false);
        expect(mgr.isOriginMuted('game')).toBe(false);
        const g = await playAndGetGain(mgr, { name: 'a.wav', volume: 50, origin: 'api' });
        expect(g.gain.value).toBeCloseTo(0.5); // 50/100 * master(1)
    });

    it('silences a live source when its origin is muted, and restores it on unmute', async () => {
        const mgr = makeManager();
        const g = await playAndGetGain(mgr, { name: 'b.wav', volume: 80, origin: 'api' });
        expect(g.gain.value).toBeCloseTo(0.8);

        mgr.setOriginMuted('api', true);
        expect(mgr.isOriginMuted('api')).toBe(true);
        expect(g.gain.value).toBe(0); // silenced in place — not stopped

        mgr.setOriginMuted('api', false);
        expect(g.gain.value).toBeCloseTo(0.8); // audible again, mid-track
    });

    it('starts a new source silent while its origin is already muted', async () => {
        const mgr = makeManager();
        mgr.setOriginMuted('api', true);
        const g = await playAndGetGain(mgr, { name: 'c.wav', volume: 70, origin: 'api' });
        expect(g.gain.value).toBe(0);
        mgr.setOriginMuted('api', false);
        expect(g.gain.value).toBeCloseTo(0.7);
    });

    it('gates the two origins independently', async () => {
        const mgr = makeManager();
        const apiGain = await playAndGetGain(mgr, { name: 'api.wav', volume: 60, origin: 'api' });
        const gameGain = await playAndGetGain(mgr, { name: 'game.wav', volume: 60, origin: 'game' });

        // Muting the game origin leaves the API source audible.
        mgr.setOriginMuted('game', true);
        expect(gameGain.gain.value).toBe(0);
        expect(apiGain.gain.value).toBeCloseTo(0.6);

        // ...and vice versa.
        mgr.setOriginMuted('api', true);
        expect(apiGain.gain.value).toBe(0);
    });

    it('defaults the origin to api when unspecified', async () => {
        const mgr = makeManager();
        mgr.setOriginMuted('api', true);
        const g = await playAndGetGain(mgr, { name: 'd.wav', volume: 50 });
        expect(g.gain.value).toBe(0);
    });
});
