import type { TriggerNode, TriggerPattern } from '../../storage/schema';
import { isEffectivelyEnabled } from '../../storage/schema';

export type { TriggerNode };

type TempFn = (matches: RegExpMatchArray) => void;

type CompiledEntry = {
    item: TriggerNode;
    test: (line: string, isPrompt: boolean) => string[] | null;
};

function buildMatcher(p: TriggerPattern): ((line: string, isPrompt: boolean) => string[] | null) | null {
    switch (p.type) {
        case 'regex': {
            if (!p.text) return null;
            let re: RegExp;
            try { re = new RegExp(p.text); } catch { return null; }
            return (line) => { const m = line.match(re); return m ? m.slice(1).map(c => c ?? '') : null; };
        }
        case 'substring':
            if (!p.text) return null;
            return (line) => line.includes(p.text) ? [] : null;
        case 'startOfLine':
            if (!p.text) return null;
            return (line) => line.startsWith(p.text) ? [] : null;
        case 'exactMatch':
            if (!p.text) return null;
            return (line) => line === p.text ? [] : null;
        case 'prompt':
            return (_line, isPrompt) => isPrompt ? [] : null;
        case 'luaFunction':
        case 'colorTrigger':
        case 'lineSpacer':
            return null; // lineSpacer is cosmetic; luaFunction/colorTrigger not yet implemented
    }
}

export class TriggerEngine {
    private readonly temp = new Map<number, { pattern: RegExp; fn: TempFn }>();
    private nextId = 1;
    private permCompiled: CompiledEntry[] = [];

    addTemp(pattern: string | RegExp, fn: TempFn): () => void {
        const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        const id = this.nextId++;
        this.temp.set(id, { pattern: re, fn });
        return () => { this.temp.delete(id); };
    }

    loadPerm(items: TriggerNode[]): void {
        this.permCompiled = [];
        for (const item of items) {
            if (!isEffectivelyEnabled(item, items)) continue;
            for (const pattern of item.patterns) {
                const test = buildMatcher(pattern);
                if (test) this.permCompiled.push({ item, test });
            }
        }
    }

    // ── Temp triggers (session-scoped, created by scripts) ────────────────────

    processTemp(line: string): void {
        for (const { pattern, fn } of this.temp.values()) {
            const m = line.match(pattern);
            if (m) fn(m);
        }
    }

    // ── Perm triggers (persisted, visible in UI) ──────────────────────────────

    matchPerm(line: string, isPrompt = false): { trigger: TriggerNode; captures: string[] }[] {
        const seen = new Set<string>();
        const results: { trigger: TriggerNode; captures: string[] }[] = [];
        for (const { item, test } of this.permCompiled) {
            if (seen.has(item.id)) continue;
            const captures = test(line, isPrompt);
            if (captures !== null) {
                seen.add(item.id);
                results.push({ trigger: item, captures });
            }
        }
        return results;
    }

    destroy(): void {
        this.temp.clear();
        this.permCompiled = [];
    }
}
