import PCRE from 'pcre2-wasm-universal';
import type { TriggerNode, TriggerPattern } from '../../storage/schema';
import { isEffectivelyEnabled } from '../../storage/schema';

export type { TriggerNode };

type TempFn = (
    matches: string[],
    spans?: { captureSpans: CaptureSpan[]; namedSpans?: Record<string, CaptureSpan> },
) => void;

/**
 * Result of matching a trigger pattern against a line.
 *
 * `captureSpans` and `namedSpans` describe where each capture sits in the
 * source line — needed by `selectCaptureGroup` so it can re-select the
 * actual occurrence rather than picking the first textual match. Spans line
 * up positionally with `captures` (so `captureSpans[0]` is the position of
 * `captures[0]`, i.e. capture group 1). Both are optional because non-PCRE
 * matchers (substring/exactMatch/etc.) don't produce capture-group spans.
 */
type CaptureSpan = { start: number; length: number };
type MatchResult = {
    captures: string[];
    matchedText: string;
    namedGroups?: Record<string, string>;
    captureSpans?: CaptureSpan[];
    namedSpans?: Record<string, CaptureSpan>;
    matchStart?: number;
};

type Matcher = (line: string, isPrompt: boolean) => MatchResult | null;

/**
 * What `matchPerm`/`processAndTrigger` hand back to the engine. Adds the
 * trigger node and the AND-trigger-only `multimatches` array on top of the
 * raw `MatchResult`.
 */
export type TriggerMatch = {
    trigger: TriggerNode;
    captures: string[];
    matchedText: string;
    multimatches?: string[][];
    namedGroups?: Record<string, string>;
    captureSpans?: CaptureSpan[];
    namedSpans?: Record<string, CaptureSpan>;
    matchStart?: number;
};

function matchResultToTriggerMatch(trigger: TriggerNode, r: MatchResult): TriggerMatch {
    return {
        trigger,
        captures: r.captures,
        matchedText: r.matchedText,
        namedGroups: r.namedGroups,
        captureSpans: r.captureSpans,
        namedSpans: r.namedSpans,
        matchStart: r.matchStart,
    };
}

type PcreInstance = InstanceType<typeof PCRE>;
type PcreMatchGroup = { start: number; end: number; match: string; name?: string; group?: number };
type PcreMatch = { length: number; [k: number]: PcreMatchGroup; [k: string]: PcreMatchGroup | number };

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
    const captureSpans: CaptureSpan[] = [];
    const namedGroups: Record<string, string> = {};
    const namedSpans: Record<string, CaptureSpan> = {};
    // pcre2-wasm-universal reports `m.length` as ovector pair count, which includes
    // the full match at index 0 — so capture groups are at 1..length-1, not 1..length.
    for (let i = 1; i < m.length; i++) {
        const cap = m[i] as PcreMatchGroup | undefined;
        // PCRE2 sets ovector to PCRE2_UNSET (start === -1) for unmatched optional
        // groups; surface those as empty strings (and zero-length spans rooted at
        // 0) to mirror prior JS-RegExp behavior.
        const matched = cap && cap.start >= 0;
        captures.push(matched ? cap!.match : '');
        captureSpans.push({
            start: matched ? cap!.start : 0,
            length: matched ? cap!.end - cap!.start : 0,
        });
        if (matched && cap!.name) {
            namedGroups[cap!.name] = cap!.match;
            namedSpans[cap!.name] = { start: cap!.start, length: cap!.end - cap!.start };
        }
    }
    return {
        captures,
        matchedText: m[0].match,
        matchStart: m[0].start,
        captureSpans,
        namedGroups: Object.keys(namedGroups).length > 0 ? namedGroups : undefined,
        namedSpans: Object.keys(namedSpans).length > 0 ? namedSpans : undefined,
    };
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
    private readonly temp = new Map<
        number,
        | { kind: 'regex'; re: PcreInstance; fn: TempFn }
        | { kind: 'substring'; pattern: string; fn: TempFn }
    >();
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
     * Register a temp trigger. `kind` selects the match strategy:
     *   - `'regex'`    — PCRE, same syntax as permanent triggers (Mudlet
     *                    `tempRegexTrigger`). The callback receives
     *                    `[fullMatch, capture1, capture2, ...]`; unmatched
     *                    optional groups surface as empty strings.
     *   - `'substring'`— literal `String.prototype.includes` (Mudlet
     *                    `tempTrigger`). The callback receives `[pattern]`
     *                    so capture-group access against the substring is a
     *                    no-op rather than a metacharacter trap.
     * Invalid regex patterns return a no-op disposer so callers don't need
     * to special-case compile failures.
     */
    addTemp(pattern: string, fn: TempFn, kind: 'regex' | 'substring' = 'regex'): () => void {
        const id = this.nextId++;
        if (kind === 'substring') {
            this.temp.set(id, { kind: 'substring', pattern, fn });
        } else {
            const re = compilePcre(pattern);
            if (!re) return () => {};
            this.temp.set(id, { kind: 'regex', re, fn });
        }
        return () => {
            const entry = this.temp.get(id);
            if (!entry) return;
            if (entry.kind === 'regex') entry.re.destroy();
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
        for (const entry of this.temp.values()) {
            if (entry.kind === 'substring') {
                if (line.includes(entry.pattern)) {
                    entry.fn([entry.pattern]);
                }
                continue;
            }
            const m = entry.re.match(line) as PcreMatch | null;
            if (!m) continue;
            const result = pcreToMatchResult(m);
            entry.fn(
                [result.matchedText, ...result.captures],
                {
                    captureSpans: result.captureSpans ?? [],
                    namedSpans: result.namedSpans,
                },
            );
        }
    }

    // ── Perm triggers (persisted, visible in UI) ──────────────────────────────

    matchPerm(line: string, isPrompt = false): TriggerMatch[] {
        const currentLine = this.lineCounter++;
        const seen = new Set<string>();
        const results: TriggerMatch[] = [];

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
                        results.push(matchResultToTriggerMatch(item, result));
                    }
                }
            } else if (entry.kind === 'and') {
                const r = this.processAndTrigger(entry, effectiveLine, isPrompt, currentLine);
                if (r) results.push(r);
            } else {
                // OR entry (non-group)
                if (entry.testAll) {
                    for (const r of entry.testAll(effectiveLine)) {
                        results.push(matchResultToTriggerMatch(item, r));
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
                        results.push(matchResultToTriggerMatch(item, result));
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
        for (const entry of this.temp.values()) {
            if (entry.kind === 'regex') entry.re.destroy();
        }
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
    ): TriggerMatch | null {
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
