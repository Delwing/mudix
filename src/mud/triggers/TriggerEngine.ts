import type { TriggerNode, TriggerPattern } from '../../storage/schema';
import { isEffectivelyEnabled } from '../../storage/schema';

export type { TriggerNode };

type TempFn = (matches: RegExpMatchArray) => void;

type MatchResult = { captures: string[]; matchedText: string; namedGroups?: Record<string, string> };

type Matcher = (line: string, isPrompt: boolean) => MatchResult | null;

type CompiledOrEntry = {
    kind: 'or';
    item: TriggerNode;
    tests: Array<Matcher>;
    testAll: ((line: string) => MatchResult[]) | null;
    depth: number;
};

type CompiledAndEntry = {
    kind: 'and';
    item: TriggerNode;
    conditions: Array<{ test: Matcher | null; spacer: number }>;
    depth: number;
};

type CompiledEntry = CompiledOrEntry | CompiledAndEntry;

type AndState = {
    nextIdx: number;
    startLine: number;
    waitUntilLine: number;
    captures: string[][];
    namedGroups: Array<Record<string, string>>;
};

/** Mutable ref so the Lua eval function can be swapped in after compilation. */
const luaEvalRef: { fn: ((code: string, line: string) => boolean) | null } = { fn: null };

function buildMatcher(p: TriggerPattern): Matcher | null {
    switch (p.type) {
        case 'regex': {
            if (!p.text) return null;
            let re: RegExp;
            try { re = new RegExp(p.text); } catch { return null; }
            return (line) => {
                const m = line.match(re);
                if (!m) return null;
                const namedGroups = m.groups ? { ...m.groups } : undefined;
                return { captures: m.slice(1).map(c => c ?? ''), matchedText: m[0], namedGroups };
            };
        }
        case 'substring':
            if (!p.text) return null;
            return (line) => line.includes(p.text) ? { captures: [], matchedText: p.text } : null;
        case 'startOfLine':
            if (!p.text) return null;
            return (line) => line.startsWith(p.text) ? { captures: [], matchedText: p.text } : null;
        case 'exactMatch':
            if (!p.text) return null;
            return (line) => line === p.text ? { captures: [], matchedText: line } : null;
        case 'prompt':
            return (_line, isPrompt) => isPrompt ? { captures: [], matchedText: '' } : null;
        case 'luaFunction': {
            // Use indirect ref so the fn can be set after compilation
            const code = p.text;
            return (line) => {
                if (!luaEvalRef.fn) return null;
                const result = luaEvalRef.fn(code, line);
                return result ? { captures: [], matchedText: line } : null;
            };
        }
        case 'colorTrigger':
        case 'lineSpacer':
            return null;
    }
}

export class TriggerEngine {
    private readonly temp = new Map<number, { pattern: RegExp; fn: TempFn }>();
    private nextId = 1;
    private permCompiled: CompiledEntry[] = [];
    private allById = new Map<string, TriggerNode>();

    // Chain state: maps group-trigger ID → last line number on which chain is open.
    private lineCounter = 0;
    private readonly chainOpenUntil = new Map<string, number>();

    // AND state: per-trigger progress for multiline AND triggers
    private andStates = new Map<string, AndState>();

    // Filter state: chainHeadId → last matched/captured text
    private filterActiveText = new Map<string, string>();

    addTemp(pattern: string | RegExp, fn: TempFn): () => void {
        const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        const id = this.nextId++;
        this.temp.set(id, { pattern: re, fn });
        return () => { this.temp.delete(id); };
    }

    loadPerm(items: TriggerNode[]): void {
        this.allById = new Map(items.map(i => [i.id, i]));
        this.permCompiled = [];

        // Collect IDs that will be compiled (for and-state cleanup)
        const compiledIds = new Set<string>();

        for (const item of items) {
            if (!isEffectivelyEnabled(item, items)) continue;
            if (!item.patterns || item.patterns.length === 0) continue;

            const depth = this.computeDepth(item);

            if (!item.isGroup && item.multiline) {
                // AND trigger: compile as a sequence of conditions
                const conditions: Array<{ test: Matcher | null; spacer: number }> = [];
                for (const p of item.patterns) {
                    if (p.type === 'lineSpacer') {
                        const n = parseInt(p.text, 10);
                        conditions.push({ test: null, spacer: isNaN(n) || n < 1 ? 1 : n });
                    } else {
                        const test = buildMatcher(p);
                        conditions.push({ test, spacer: 0 });
                    }
                }
                if (conditions.length > 0) {
                    compiledIds.add(item.id);
                    this.permCompiled.push({ kind: 'and', item, conditions, depth });
                }
            } else {
                // OR trigger (or group): any pattern fires
                const tests: Matcher[] = [];
                let testAll: ((line: string) => MatchResult[]) | null = null;

                for (const pattern of item.patterns) {
                    const test = buildMatcher(pattern);
                    if (test) tests.push(test);

                    // multipleMatches only for non-group regex patterns
                    if (!item.isGroup && item.multipleMatches && pattern.type === 'regex' && pattern.text) {
                        try {
                            const re = new RegExp(pattern.text, 'g');
                            testAll = (line: string) => {
                                const results: MatchResult[] = [];
                                for (const m of line.matchAll(re)) {
                                    const namedGroups = m.groups ? { ...m.groups } : undefined;
                                    results.push({ captures: m.slice(1).map(c => c ?? ''), matchedText: m[0], namedGroups });
                                }
                                return results;
                            };
                        } catch { /* invalid regex */ }
                    }
                }

                if (tests.length > 0) {
                    compiledIds.add(item.id);
                    this.permCompiled.push({ kind: 'or', item, tests, testAll, depth });
                }
            }
        }

        // Sort by depth so parents (chain heads) are always processed before children.
        this.permCompiled.sort((a, b) => a.depth - b.depth);

        // Clean up AND states for triggers no longer compiled
        for (const id of this.andStates.keys()) {
            if (!compiledIds.has(id)) this.andStates.delete(id);
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

    matchPerm(line: string, isPrompt = false): {
        trigger: TriggerNode;
        captures: string[];
        matchedText: string;
        multimatches?: string[][];
        namedGroups?: Record<string, string>;
    }[] {
        const currentLine = this.lineCounter++;
        const seen = new Set<string>();
        const results: {
            trigger: TriggerNode;
            captures: string[];
            matchedText: string;
            multimatches?: string[][];
            namedGroups?: Record<string, string>;
        }[] = [];

        for (const entry of this.permCompiled) {
            const { item } = entry;
            if (!this.isChainAccessible(item, currentLine)) continue;

            const effectiveLine = this.getEffectiveLine(item, line);

            if (item.isGroup) {
                // Chain head: match opens the chain for children.
                if (seen.has(item.id)) continue;
                // Groups are always OR-compiled
                const orEntry = entry as CompiledOrEntry;
                let result: MatchResult | null = null;
                for (const test of orEntry.tests) {
                    result = test(effectiveLine, isPrompt);
                    if (result !== null) break;
                }
                if (result !== null) {
                    seen.add(item.id);
                    this.chainOpenUntil.set(item.id, currentLine + (item.fireLength ?? 0));
                    // Update filter state if this is a filter group
                    if (item.isFilter) {
                        this.filterActiveText.set(item.id, result.captures[0] ?? result.matchedText);
                    }
                    if (item.code) {
                        results.push({
                            trigger: item,
                            captures: result.captures,
                            matchedText: result.matchedText,
                            namedGroups: result.namedGroups,
                        });
                    }
                }
            } else if (entry.kind === 'and') {
                const r = this.processAndTrigger(entry, effectiveLine, isPrompt, currentLine);
                if (r) results.push(r);
            } else {
                // OR entry (non-group)
                if (entry.testAll) {
                    for (const { captures, matchedText, namedGroups } of entry.testAll(effectiveLine)) {
                        results.push({ trigger: item, captures, matchedText, namedGroups });
                    }
                } else {
                    if (seen.has(item.id)) continue;
                    let result: MatchResult | null = null;
                    for (const test of entry.tests) {
                        result = test(effectiveLine, isPrompt);
                        if (result !== null) break;
                    }
                    if (result !== null) {
                        seen.add(item.id);
                        results.push({
                            trigger: item,
                            captures: result.captures,
                            matchedText: result.matchedText,
                            namedGroups: result.namedGroups,
                        });
                    }
                }
            }
        }

        return results;
    }

    setLuaEval(fn: ((code: string, line: string) => boolean) | null): void {
        luaEvalRef.fn = fn;
    }

    destroy(): void {
        this.temp.clear();
        this.permCompiled = [];
        this.allById.clear();
        this.chainOpenUntil.clear();
        this.lineCounter = 0;
        this.andStates.clear();
        this.filterActiveText.clear();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private processAndTrigger(
        entry: CompiledAndEntry,
        effectiveLine: string,
        isPrompt: boolean,
        currentLine: number,
    ): {
        trigger: TriggerNode;
        captures: string[];
        matchedText: string;
        multimatches?: string[][];
        namedGroups?: Record<string, string>;
    } | null {
        const { item, conditions } = entry;
        const delta = item.delta ?? 0;
        let state = this.andStates.get(item.id);

        // Check delta expiry
        if (state && delta > 0 && currentLine - state.startLine > delta) {
            this.andStates.delete(item.id);
            state = undefined;
        }

        if (!state) {
            // Try to match conditions[0]
            const cond0 = conditions[0];
            if (!cond0 || cond0.spacer > 0) return null; // can't start on a spacer
            if (!cond0.test) return null;
            const result = cond0.test(effectiveLine, isPrompt);
            if (!result) return null;
            state = {
                nextIdx: 1,
                startLine: currentLine,
                waitUntilLine: currentLine,
                captures: [result.captures],
                namedGroups: [result.namedGroups ?? {}],
            };
            this.andStates.set(item.id, state);
        }

        // Try to advance state
        while (state.nextIdx < conditions.length) {
            if (currentLine < state.waitUntilLine) break;

            const cond = conditions[state.nextIdx];

            if (cond.spacer > 0) {
                // Line spacer: set wait and advance, then break to wait
                state.waitUntilLine = currentLine + cond.spacer;
                state.nextIdx++;
                break; // must wait
            }

            if (!cond.test) {
                // null test (shouldn't happen outside spacer) — skip
                state.nextIdx++;
                continue;
            }

            const result = cond.test(effectiveLine, isPrompt);
            if (!result) break; // didn't match this line

            state.captures.push(result.captures);
            state.namedGroups.push(result.namedGroups ?? {});
            state.nextIdx++;
            // try next condition on same line
        }

        if (state.nextIdx >= conditions.length) {
            // All conditions matched — fire
            this.andStates.delete(item.id);
            const allCaptures = state.captures.flat();
            const lastNamedGroups = state.namedGroups[state.namedGroups.length - 1] ?? {};
            return {
                trigger: item,
                captures: allCaptures,
                matchedText: '',
                multimatches: state.captures,
                namedGroups: Object.keys(lastNamedGroups).length > 0 ? lastNamedGroups : undefined,
            };
        }

        // Partial match — save state
        this.andStates.set(item.id, state);
        return null;
    }

    /**
     * Returns the effective line to match against for `item`.
     * If a filter-group ancestor has active filter text, that text is used instead.
     * Innermost filter wins.
     */
    private getEffectiveLine(item: TriggerNode, originalLine: string): string {
        let effective = originalLine;
        let parentId = item.parentId;
        while (parentId) {
            const parent = this.allById.get(parentId);
            if (!parent) break;
            if (parent.isGroup && parent.isFilter) {
                const filtered = this.filterActiveText.get(parentId);
                if (filtered !== undefined) effective = filtered;
                // innermost filter wins, so break after first filter ancestor we find going up
                // (we walk from child up so first one found IS the innermost)
                break;
            }
            parentId = parent.parentId;
        }
        return effective;
    }

    /**
     * A trigger is chain-accessible if every group ancestor with patterns has an
     * open chain (matched within the last fireLength lines, inclusive of the
     * current line). Regular group ancestors (no patterns) always grant access.
     */
    private isChainAccessible(item: TriggerNode, currentLine: number): boolean {
        let parentId = item.parentId;
        while (parentId) {
            const parent = this.allById.get(parentId);
            if (!parent) break;
            if (parent.isGroup && parent.patterns && parent.patterns.length > 0) {
                const openUntil = this.chainOpenUntil.get(parentId);
                if (openUntil === undefined || openUntil < currentLine) return false;
            }
            parentId = parent.parentId;
        }
        return true;
    }

    private computeDepth(item: TriggerNode): number {
        let depth = 0;
        let parentId = item.parentId;
        while (parentId) {
            const parent = this.allById.get(parentId);
            if (!parent) break;
            depth++;
            parentId = parent.parentId;
        }
        return depth;
    }
}
