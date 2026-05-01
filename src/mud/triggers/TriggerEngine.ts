export interface PermanentTrigger {
    id: string;
    name: string;
    pattern: string;   // regex string
    code: string;
    language: 'lua' | 'js';
    enabled: boolean;
}

type TempFn = (matches: RegExpMatchArray) => void;

export class TriggerEngine {
    private readonly temp = new Map<number, { pattern: RegExp; fn: TempFn }>();
    private nextId = 1;
    private perm: PermanentTrigger[] = [];

    // ── Temp triggers (session-scoped, created by scripts) ────────────────────

    addTemp(pattern: string | RegExp, fn: TempFn): () => void {
        const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        const id = this.nextId++;
        this.temp.set(id, { pattern: re, fn });
        return () => { this.temp.delete(id); };
    }

    /** Fire all matching temp triggers against `line`. Does not stop at first match. */
    processTemp(line: string): void {
        for (const { pattern, fn } of this.temp.values()) {
            const m = line.match(pattern);
            if (m) fn(m);
        }
    }

    // ── Perm triggers (persisted, visible in UI) ──────────────────────────────

    loadPerm(triggers: PermanentTrigger[]): void {
        this.perm = triggers.filter(t => t.enabled);
    }

    /** Returns all perm triggers that match `line`, in order. */
    matchPerm(line: string): { trigger: PermanentTrigger; captures: string[] }[] {
        const results: { trigger: PermanentTrigger; captures: string[] }[] = [];
        for (const trigger of this.perm) {
            try {
                const m = line.match(new RegExp(trigger.pattern));
                if (m) results.push({ trigger, captures: m.slice(1).map(c => c ?? '') });
            } catch {
                // skip triggers with invalid patterns
            }
        }
        return results;
    }

    destroy(): void {
        this.temp.clear();
        this.perm = [];
    }
}
