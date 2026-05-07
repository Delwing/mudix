import PCRE from 'pcre2-wasm-universal';
import type { TriggerNode, TriggerPattern } from '../../storage/schema';
import { isEffectivelyEnabled } from '../../storage/schema';

export type { TriggerNode };

type TempFn = (matches: string[]) => void;

type MatchResult = { captures: string[]; matchedText: string; namedGroups?: Record<string, string> };

type Matcher = (line: string, isPrompt: boolean) => MatchResult | null;

type PcreInstance = InstanceType<typeof PCRE>;
type PcreMatch = { length: number; [k: number]: { start: number; end: number; match: string } };

/** Kicked off at module load so PCRE is ready by the time anything matches. */
const pcreReadyPromise = PCRE.init();

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

function pcreToMatchResult(m: PcreMatch): MatchResult {
    const captures: string[] = [];
    // pcre2-wasm-universal reports `m.length` as ovector pair count, which includes
    // the full match at index 0 — so capture groups are at 1..length-1, not 1..length.
    for (let i = 1; i < m.length; i++) {
        const cap = m[i];
        // PCRE2 sets ovector to PCRE2_UNSET (start === -1) for unmatched optional
        // groups; surface those as empty strings to mirror prior JS-RegExp behavior.
        captures.push(cap && cap.start >= 0 ? cap.match : '');
    }
    return { captures, matchedText: m[0].match };
}

/**
 * Compile a PCRE pattern. Returns null if compilation fails, with the failure
 * sticky-cached so we don't retry on every match.
 */
function compilePcre(pattern: string): PcreInstance | null {
    try { return new PCRE(pattern); }
    catch { return null; }
}

function buildMatcher(p: TriggerPattern, register: (re: PcreInstance) => void): Matcher | null {
    switch (p.type) {
        case 'regex': {
            if (!p.text) return null;
            const re = compilePcre(p.text);
            if (!re) return null;
            register(re);
            return (line) => {
                const m = re.match(line) as PcreMatch | null;
                if (!m) return null;
                return pcreToMatchResult(m);
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
            const code = p.text;
            return (line) => {
                if (!luaEvalRef.fn) return null;
                return luaEvalRef.fn(code, line) ? { captures: [], matchedText: line } : null;
            };
        }
        case 'colorTrigger':
        case 'lineSpacer':
            return null;
    }
}

export class TriggerEngine {
    private readonly temp = new Map<number, { re: PcreInstance; fn: TempFn }>();
    private nextId = 1;
    private permCompiled: CompiledEntry[] = [];
    private allById = new Map<string, TriggerNode>();

    // Compiled PCRE instances for the current permCompiled set; destroyed and
    // rebuilt on each loadPerm. Tracked here (not on individual entries) so the
    // matcher closures stay simple — they don't need to know about lifecycle.
    private pcreInstances: PcreInstance[] = [];

    // Chain state: maps group-trigger ID → last line number on which chain is open.
    private lineCounter = 0;
    private readonly chainOpenUntil = new Map<string, number>();

    // AND state: per-trigger progress for multiline AND triggers
    private andStates = new Map<string, AndState>();

    // Filter state: chainHeadId → last matched/captured text
    private filterActiveText = new Map<string, string>();

    /** Resolves once PCRE wasm is initialized and patterns can be compiled. */
    static ready(): Promise<void> {
        return pcreReadyPromise.then(() => undefined);
    }

    /**
     * Register a temp trigger. The pattern is compiled with PCRE so it matches
     * the same syntax as permanent triggers. Invalid patterns return a no-op
     * disposer so the caller doesn't need to special-case compile failures.
     * The `fn` callback receives `[fullMatch, capture1, capture2, ...]` —
     * unmatched optional groups surface as empty strings.
     */
    addTemp(pattern: string, fn: TempFn): () => void {
        const re = compilePcre(pattern);
        if (!re) return () => {};
        const id = this.nextId++;
        this.temp.set(id, { re, fn });
        return () => {
            const entry = this.temp.get(id);
            if (!entry) return;
            entry.re.destroy();
            this.temp.delete(id);
        };
    }

    loadPerm(items: TriggerNode[]): void {
        this.allById = new Map(items.map(i => [i.id, i]));
        this.permCompiled = [];
        // Free previous PCRE instances before rebuilding.
        for (const re of this.pcreInstances) re.destroy();
        this.pcreInstances = [];
        const register = (re: PcreInstance) => { this.pcreInstances.push(re); };

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
                        const test = buildMatcher(p, register);
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
                    const test = buildMatcher(pattern, register);
                    if (test) tests.push(test);

                    // multipleMatches only for non-group regex patterns
                    if (!item.isGroup && item.multipleMatches && pattern.type === 'regex' && pattern.text) {
                        const re = compilePcre(pattern.text);
                        if (re) {
                            register(re);
                            testAll = (line: string) => {
                                const results: MatchResult[] = [];
                                for (const m of re.matchAll(line) as PcreMatch[]) {
                                    results.push(pcreToMatchResult(m));
                                }
                                return results;
                            };
                        }
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
        for (const { re, fn } of this.temp.values()) {
            const m = re.match(line) as PcreMatch | null;
            if (!m) continue;
            const result = pcreToMatchResult(m);
            fn([result.matchedText, ...result.captures]);
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
        for (const { re } of this.temp.values()) re.destroy();
        this.temp.clear();
        this.permCompiled = [];
        for (const re of this.pcreInstances) re.destroy();
        this.pcreInstances = [];
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
