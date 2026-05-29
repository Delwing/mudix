// Mudlet `playVideoFile / pauseVideos / stopVideos`. mudix mounts <video>
// elements as absolutely-positioned overlay children of the main viewport.
// Video files are looked up through the same loader callback the SoundManager
// uses, so VFS paths and http(s) URLs both work.
//
// This is intentionally minimal — Mudlet's spec is just "play a video file";
// per-channel routing and z-ordering can be added later. Each play creates
// (or replaces) a single video element keyed by name; pauseVideos pauses all,
// stopVideos pauses + removes them.

type LoaderFn = (path: string) => Promise<ArrayBuffer | null>;

export interface PlayVideoOptions {
    name: string;
    /** 0..100 — Mudlet scale. Default 50. */
    volume?: number;
    /** Loop count. 1 = play once (default). -1 = infinite. */
    loops?: number;
    /** CSS units; default fills the viewport. */
    width?: string;
    height?: string;
}

interface ActiveVideo {
    name: string;
    /** Original path/URL the video was played from (for getPlayingVideos). */
    path: string;
    element: HTMLVideoElement;
    objectUrl: string | null;
}

export class VideoManager {
    private loader: LoaderFn | null = null;
    /** Returns the DOM element that videos should be attached to. Set by
     *  WindowManager.observeMain so videos drop onto the main viewport. */
    private getMount: (() => HTMLElement | null) | null = null;
    private active = new Map<string, ActiveVideo>();
    /** Buffers fetched ahead of play via loadVideoFile, keyed by VFS path. */
    private prefetched = new Map<string, ArrayBuffer>();
    /** Fires when a video ends naturally or is stopped — mirrors Mudlet's
     *  sysMediaFinished. */
    onEnded: ((name: string, path: string) => void) | null = null;

    setLoader(fn: LoaderFn | null): void {
        this.loader = fn;
    }

    setMountPoint(fn: (() => HTMLElement | null) | null): void {
        this.getMount = fn;
    }

    /**
     * Mudlet `loadVideoFile`. Preloads (fetches + caches) a VFS-backed video so
     * the first playVideoFile has no fetch latency. http(s)/data/blob URLs need
     * no preloading (the element fetches them directly) and report success.
     * Returns false when no loader is wired or the fetch fails.
     */
    async preload(path: string): Promise<boolean> {
        const target = (path ?? '').trim();
        if (!target) return false;
        if (/^https?:|^data:|^blob:/.test(target)) return true;
        if (this.prefetched.has(target)) return true;
        const buf = await this.loader?.(target) ?? null;
        if (!buf) return false;
        this.prefetched.set(target, buf);
        return true;
    }

    async play(path: string, opts: PlayVideoOptions): Promise<boolean> {
        const mount = this.getMount?.() ?? null;
        if (!mount) return false;
        const name = opts.name || path.split(/[/\\]/).pop() || path;
        this.stopByName(name);

        let src: string;
        let objectUrl: string | null = null;
        if (/^https?:|^data:|^blob:/.test(path)) {
            src = path;
        } else {
            const buf = this.prefetched.get(path) ?? await this.loader?.(path) ?? null;
            if (!buf) return false;
            const blob = new Blob([buf as BlobPart], { type: 'video/mp4' });
            objectUrl = URL.createObjectURL(blob);
            src = objectUrl;
        }

        const el = document.createElement('video');
        el.src = src;
        el.autoplay = true;
        el.controls = false;
        el.playsInline = true;
        el.loop = (opts.loops ?? 1) < 0;
        el.volume = Math.max(0, Math.min(1, (opts.volume ?? 50) / 100));
        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = opts.width ?? '100%';
        el.style.height = opts.height ?? '100%';
        el.style.objectFit = 'contain';
        el.style.zIndex = '500';
        el.style.background = 'transparent';
        el.style.pointerEvents = 'none';

        const entry: ActiveVideo = { name, path, element: el, objectUrl };
        el.addEventListener('ended', () => {
            // For finite loops > 1, replay manually until counter exhausts.
            const desired = opts.loops ?? 1;
            if (desired > 1) {
                const left = Number(el.dataset.loopsLeft ?? desired) - 1;
                if (left > 0) {
                    el.dataset.loopsLeft = String(left);
                    el.currentTime = 0;
                    void el.play();
                    return;
                }
            }
            this.stopByName(name);
            this.onEnded?.(name, path);
        });
        mount.appendChild(el);
        this.active.set(name, entry);
        try {
            await el.play();
        } catch {
            // Autoplay may be blocked by user-gesture policy; the element still
            // exists and the user can recover via pause/resume scripts.
        }
        return true;
    }

    pauseAll(): void {
        for (const v of this.active.values()) v.element.pause();
    }

    /**
     * Mudlet `getPlayingVideos([settings])` / `getPausedVideos([settings])`.
     * Lists the videos currently in the requested play state, optionally
     * filtered by name. Volume is reported on Mudlet's 0..100 scale.
     */
    getByState(
        wantPaused: boolean,
        filter: { name?: string } = {},
    ): Array<{ name: string; path: string; volume: number }> {
        const out: Array<{ name: string; path: string; volume: number }> = [];
        for (const v of this.active.values()) {
            if (v.element.paused !== wantPaused) continue;
            if (filter.name && v.name !== filter.name) continue;
            out.push({ name: v.name, path: v.path, volume: Math.round(v.element.volume * 100) });
        }
        return out;
    }

    stopAll(): void {
        for (const name of Array.from(this.active.keys())) this.stopByName(name);
    }

    private stopByName(name: string): void {
        const v = this.active.get(name);
        if (!v) return;
        try { v.element.pause(); } catch { /* element may already be detached */ }
        v.element.remove();
        if (v.objectUrl) URL.revokeObjectURL(v.objectUrl);
        this.active.delete(name);
    }

    destroy(): void {
        this.stopAll();
        this.prefetched.clear();
        this.loader = null;
        this.getMount = null;
        this.onEnded = null;
    }
}
