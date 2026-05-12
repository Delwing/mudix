import type { TimerNode } from '../../storage/schema';
import { buildEffectivelyEnabledIds } from '../../storage/schema';

export type { TimerNode };

type TempFn = () => void;
type ExecuteFn = (timer: TimerNode) => void;

interface TimerEntry {
    handle: ReturnType<typeof setTimeout>;
    repeat: boolean;
    /** Epoch ms when the timer was scheduled — start point for remainingTime. */
    start: number;
    /** Delay/interval in ms (Mudlet stores seconds; we store the resolved ms). */
    intervalMs: number;
}

export class TimerEngine {
    private readonly temp = new Map<number, TimerEntry>();
    /** Permanent timers keyed by stored TimerNode id (uuid). Two timers can
     *  share a name; we keep id as the canonical handle and build a separate
     *  name → id index for Mudlet's name-based lookups. */
    private readonly perm = new Map<string, TimerEntry>();
    /** Name → first matching id, used by remainingTime / kill-by-name. */
    private readonly permNameToId = new Map<string, string>();
    private nextId = 1;

    addTemp(seconds: number, fn: TempFn, repeat = false): number {
        const id = this.nextId++;
        const intervalMs = seconds * 1000;
        const start = Date.now();
        if (repeat) {
            const handle = setInterval(fn, intervalMs) as unknown as ReturnType<typeof setTimeout>;
            this.temp.set(id, { handle, repeat: true, start, intervalMs });
        } else {
            const handle = setTimeout(() => {
                this.temp.delete(id);
                fn();
            }, intervalMs);
            this.temp.set(id, { handle, repeat: false, start, intervalMs });
        }
        return id;
    }

    killTimer(id: number): boolean {
        const entry = this.temp.get(id);
        if (!entry) return false;
        if (entry.repeat) clearInterval(entry.handle as unknown as number);
        else clearTimeout(entry.handle);
        this.temp.delete(id);
        return true;
    }

    loadPerm(timers: TimerNode[], executeFn: ExecuteFn): void {
        this.stopPerm();
        const enabledIds = buildEffectivelyEnabledIds(timers);
        for (const timer of timers) {
            if (!enabledIds.has(timer.id)) continue;
            if (timer.isGroup && !timer.code) continue;
            const fire = () => executeFn(timer);
            const intervalMs = timer.seconds * 1000;
            const start = Date.now();
            if (timer.repeat) {
                const handle = setInterval(fire, intervalMs) as unknown as ReturnType<typeof setTimeout>;
                this.perm.set(timer.id, { handle, repeat: true, start, intervalMs });
            } else {
                const handle = setTimeout(() => {
                    this.perm.delete(timer.id);
                    if (this.permNameToId.get(timer.name) === timer.id) {
                        this.permNameToId.delete(timer.name);
                    }
                    fire();
                }, intervalMs);
                this.perm.set(timer.id, { handle, repeat: false, start, intervalMs });
            }
            // First-write-wins on duplicate names so remainingTime / kill-by-name
            // pick the earliest-loaded timer when scripts share names.
            if (!this.permNameToId.has(timer.name)) this.permNameToId.set(timer.name, timer.id);
        }
    }

    /**
     * Mudlet `remainingTime(idOrName)` — seconds until the next fire. For
     * non-repeating timers, returns the time left before the one and only
     * fire. For repeating timers, returns the time until the next tick.
     * Returns -1 if no live timer matches (Mudlet's miss sentinel).
     *   - Numeric arg: looks up tempTimer ids only.
     *   - String arg: looks up permanent timer names; falls back to the stored
     *     TimerNode id when the string is a uuid that no name matched.
     */
    remainingTime(idOrName: number | string): number {
        let entry: TimerEntry | undefined;
        if (typeof idOrName === 'number') {
            entry = this.temp.get(idOrName);
        } else {
            // String arg: try uuid first, then name → uuid via the index.
            entry = this.perm.get(idOrName);
            if (!entry) {
                const id = this.permNameToId.get(idOrName);
                entry = id ? this.perm.get(id) : undefined;
            }
        }
        if (!entry) return -1;
        const elapsed = Date.now() - entry.start;
        const ms = entry.repeat
            ? entry.intervalMs - (elapsed % entry.intervalMs)
            : Math.max(0, entry.intervalMs - elapsed);
        return ms / 1000;
    }

    private stopPerm(): void {
        for (const { handle, repeat } of this.perm.values()) {
            if (repeat) clearInterval(handle as unknown as number);
            else clearTimeout(handle);
        }
        this.perm.clear();
        this.permNameToId.clear();
    }

    destroy(): void {
        for (const { handle, repeat } of this.temp.values()) {
            if (repeat) clearInterval(handle as unknown as number);
            else clearTimeout(handle);
        }
        this.temp.clear();
        this.stopPerm();
    }
}
