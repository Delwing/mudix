import type { AliasNode } from '../../storage/schema';
import { PatternEngine } from '../PatternEngine';

export type { AliasNode };

export class AliasEngine extends PatternEngine<AliasNode> {
    // ── Temp aliases (session-scoped, created by scripts) ─────────────────────

    /** Returns true and fires the first matching temp alias. Stops at first match. */
    processTemp(input: string): boolean {
        for (const { pattern, fn } of this.temp.values()) {
            const m = input.match(pattern);
            if (m) { fn(m); return true; }
        }
        return false;
    }

    // ── Perm aliases (persisted, visible in UI) ────────────────────────────────

    /** Returns the first matching perm alias, or null. */
    matchPerm(input: string): { alias: AliasNode; captures: string[] } | null {
        for (const { item, re } of this.permCompiled) {
            const m = input.match(re);
            if (m) return { alias: item, captures: m.slice(1).map(c => c ?? '') };
        }
        return null;
    }
}
