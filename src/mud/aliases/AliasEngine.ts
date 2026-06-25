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

    /** Returns the first matching perm alias, or null. `matchedText` is the
     *  portion of `input` the regex actually matched (Mudlet's `matches[1]`),
     *  which differs from the whole input for an unanchored pattern. */
    matchPerm(input: string): { alias: AliasNode; matchedText: string; captures: string[] } | null {
        for (const { item, re } of this.permCompiled) {
            const m = input.match(re);
            if (m) return { alias: item, matchedText: m[0], captures: m.slice(1).map(c => c ?? '') };
        }
        return null;
    }
}
