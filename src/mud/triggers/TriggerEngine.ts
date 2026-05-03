import type { PermanentTrigger } from '../../storage/schema';
import { PatternEngine } from '../PatternEngine';

export type { PermanentTrigger };

export class TriggerEngine extends PatternEngine<PermanentTrigger> {
    // ── Temp triggers (session-scoped, created by scripts) ────────────────────

    /** Fires all matching temp triggers against `line`. Does not stop at first match. */
    processTemp(line: string): void {
        for (const { pattern, fn } of this.temp.values()) {
            const m = line.match(pattern);
            if (m) fn(m);
        }
    }

    // ── Perm triggers (persisted, visible in UI) ──────────────────────────────

    /** Returns all perm triggers that match `line`, in order. */
    matchPerm(line: string): { trigger: PermanentTrigger; captures: string[] }[] {
        const results: { trigger: PermanentTrigger; captures: string[] }[] = [];
        for (const { item, re } of this.permCompiled) {
            const m = line.match(re);
            if (m) results.push({ trigger: item, captures: m.slice(1).map(c => c ?? '') });
        }
        return results;
    }
}
