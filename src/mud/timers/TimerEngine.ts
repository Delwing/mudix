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

    /**
     * Cached previous load. `nodes` is the TimerNode keyed by id, `desc` is the
     * shape that determines whether the running setTimeout/setInterval is still
     * correct (seconds, repeat, isGroup, code presence, name) — if `desc` is
     * unchanged AND the timer is still enabled, the live handle is left alone.
     * This makes a name-toggle that disables one timer cost one clearTimeout
     * instead of "clear all + recreate all".
     */
    private readonly prevDesc = new Map<string, string>();

    private descOf(t: TimerNode): string {
        return `${t.seconds}|${t.repeat ? 1 : 0}|${t.isGroup ? 1 : 0}|${t.code ? 1 : 0}|${t.command ?? ''}|${t.language ?? ''}|${t.name}`;
    }

    loadPerm(timers: TimerNode[], executeFn: ExecuteFn): void {
        const enabledIds = buildEffectivelyEnabledIds(timers);
        const nextIds = new Set<string>();
        const nextDesc = new Map<string, string>();
        const nextNames = new Map<string, string>();

        for (const timer of timers) {
            const wantRun = enabledIds.has(timer.id) && !(timer.isGroup && !timer.code);
            const desc = this.descOf(timer);
            const prevDesc = this.prevDesc.get(timer.id);
            const isLive = this.perm.has(timer.id);

            if (!wantRun) {
                // Drop any live handle for an item that is no longer enabled.
                if (isLive) this.killPermHandle(timer.id);
                continue;
            }

            nextIds.add(timer.id);
            nextDesc.set(timer.id, desc);

            if (isLive && prevDesc === desc) {
                // Same shape, still enabled — leave the running handle alone so
                // remainingTime keeps reporting against the original schedule.
            } else {
                if (isLive) this.killPermHandle(timer.id);
                this.startPerm(timer, executeFn);
            }
            if (!nextNames.has(timer.name)) nextNames.set(timer.name, timer.id);
        }

        // Drop handles for items that disappeared from the list entirely.
        for (const id of [...this.perm.keys()]) {
            if (!nextIds.has(id)) this.killPermHandle(id);
        }

        this.prevDesc.clear();
        for (const [k, v] of nextDesc) this.prevDesc.set(k, v);
        this.permNameToId.clear();
        for (const [k, v] of nextNames) this.permNameToId.set(k, v);
    }

    private startPerm(timer: TimerNode, executeFn: ExecuteFn): void {
        const fire = () => executeFn(timer);
        const intervalMs = timer.seconds * 1000;
        const start = Date.now();
        if (timer.repeat) {
            const handle = setInterval(fire, intervalMs) as unknown as ReturnType<typeof setTimeout>;
            this.perm.set(timer.id, { handle, repeat: true, start, intervalMs });
        } else {
            const handle = setTimeout(() => {
                this.perm.delete(timer.id);
                this.prevDesc.delete(timer.id);
                if (this.permNameToId.get(timer.name) === timer.id) {
                    this.permNameToId.delete(timer.name);
                }
                fire();
            }, intervalMs);
            this.perm.set(timer.id, { handle, repeat: false, start, intervalMs });
        }
    }

    private killPermHandle(id: string): void {
        const entry = this.perm.get(id);
        if (!entry) return;
        if (entry.repeat) clearInterval(entry.handle as unknown as number);
        else clearTimeout(entry.handle);
        this.perm.delete(id);
        this.prevDesc.delete(id);
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
        this.prevDesc.clear();
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
