import type { TimerNode } from '../../storage/schema';
import { isEffectivelyEnabled } from '../../storage/schema';

export type { TimerNode };

type TempFn = () => void;
type ExecuteFn = (timer: TimerNode) => void;

export class TimerEngine {
    private readonly temp = new Map<number, { handle: ReturnType<typeof setTimeout>; repeat: boolean }>();
    private readonly perm = new Map<string, { handle: ReturnType<typeof setTimeout>; repeat: boolean }>();
    private nextId = 1;

    addTemp(seconds: number, fn: TempFn, repeat = false): number {
        const id = this.nextId++;
        if (repeat) {
            const handle = setInterval(fn, seconds * 1000) as unknown as ReturnType<typeof setTimeout>;
            this.temp.set(id, { handle, repeat: true });
        } else {
            const handle = setTimeout(() => {
                this.temp.delete(id);
                fn();
            }, seconds * 1000);
            this.temp.set(id, { handle, repeat: false });
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
        for (const timer of timers) {
            if (!isEffectivelyEnabled(timer, timers)) continue;
            if (timer.isGroup && !timer.code) continue;
            const fire = () => executeFn(timer);
            if (timer.repeat) {
                const handle = setInterval(fire, timer.seconds * 1000) as unknown as ReturnType<typeof setTimeout>;
                this.perm.set(timer.id, { handle, repeat: true });
            } else {
                const handle = setTimeout(() => {
                    this.perm.delete(timer.id);
                    fire();
                }, timer.seconds * 1000);
                this.perm.set(timer.id, { handle, repeat: false });
            }
        }
    }

    private stopPerm(): void {
        for (const { handle, repeat } of this.perm.values()) {
            if (repeat) clearInterval(handle as unknown as number);
            else clearTimeout(handle);
        }
        this.perm.clear();
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
