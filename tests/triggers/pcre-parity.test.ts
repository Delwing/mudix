// @vitest-environment node
//
// Parity guard for the vendored PCRE2 wrapper (`src/mud/triggers/pcre/Pcre2.ts`),
// a performance-tuned fork of `pcre2-wasm-universal`'s wrapper that shares a
// pre-encoded line buffer and reuses match-data across calls. Because the
// trigger engine matches against the fork rather than upstream, this asserts the
// fork returns byte-for-byte the same match shape (full match, captures, capture
// offsets, named groups) as upstream across a corpus that exercises captures,
// named groups, unmatched optional groups, anchors, multiple matches, and
// non-matches. If the two ever diverge, triggers would behave differently from
// the documented PCRE2 semantics.

import { describe, it, expect } from 'vitest';
import UpstreamPCRE from 'pcre2-wasm-universal';
import VendoredPCRE from '../../src/mud/triggers/pcre/Pcre2';

type Group = { start: number; end: number; match: string; name?: string };
type Norm = { length: number; groups: Group[]; named: Record<string, string> } | null;

// Collapse a wrapper match result into a structure comparable across the two
// implementations: positional groups plus the named-group map.
function normalize(m: unknown): Norm {
    if (m === null || m === undefined) return null;
    const rec = m as Record<string | number, { start: number; end: number; match: string; name?: string } | number>;
    const length = rec.length as number;
    const groups: Group[] = [];
    for (let i = 0; i < length; i++) {
        const g = rec[i] as { start: number; end: number; match: string; name?: string };
        groups.push({ start: g.start, end: g.end, match: g.match, name: g.name });
    }
    const named: Record<string, string> = {};
    for (const k of Object.keys(rec)) {
        if (k === 'length' || /^\d+$/.test(k)) continue;
        const g = rec[k] as { match: string };
        named[k] = g.match;
    }
    return { length, groups, named };
}

const CASES: Array<{ pattern: string; line: string }> = [
    { pattern: '(\\d+) gold', line: 'you find 42 gold coins' },
    { pattern: '^You see (.+) here\\.$', line: 'You see a rusty sword here.' },
    { pattern: '(?<hp>\\d+)/(?<max>\\d+)', line: 'HP: 30/100 remaining' },
    { pattern: 'foo(bar)?baz', line: 'foobaz' },                 // unmatched optional group
    { pattern: 'foo(bar)?baz', line: 'foobarbaz' },              // matched optional group
    { pattern: '^(\\w+) tells you: (.+)$', line: 'Gandalf tells you: run' },
    { pattern: '\\b(\\w+)@(\\w+)\\.(\\w{2,4})\\b', line: 'mail me at bob@example.com today' },
    { pattern: 'nothing-here', line: 'this line will not match at all' },
    { pattern: '^$', line: '' },                                  // empty-line anchor
    { pattern: '(a|b)(c|d)', line: 'zzz bd zzz' },
];

describe('vendored PCRE2 wrapper parity with upstream', () => {
    it('produces identical match() results across the corpus', async () => {
        await UpstreamPCRE.init();
        await VendoredPCRE.init();

        for (const { pattern, line } of CASES) {
            const u = new UpstreamPCRE(pattern);
            const v = new VendoredPCRE(pattern);
            expect(normalize(v.match(line)), `pattern ${pattern} / line "${line}"`)
                .toEqual(normalize(u.match(line)));
            u.destroy();
            v.destroy();
        }
    }, 60000);

    it('produces identical matchAll() results', async () => {
        await UpstreamPCRE.init();
        await VendoredPCRE.init();

        const pattern = '(\\d+)';
        const line = 'rooms 1 and 22 and 333 and 4';
        const u = new UpstreamPCRE(pattern);
        const v = new VendoredPCRE(pattern);
        expect((v.matchAll(line) as unknown[]).map(normalize))
            .toEqual((u.matchAll(line) as unknown[]).map(normalize));
        u.destroy();
        v.destroy();
    }, 60000);

    it('reuses the shared line buffer across patterns without corruption', async () => {
        await VendoredPCRE.init();
        // Same line reference handed to many patterns (the per-line scan shape):
        // the second pattern must not see a buffer truncated/grown by the first.
        const line = 'The dragon hits you for 250 damage and you have 30/100 hp';
        const a = new VendoredPCRE('(\\d+) damage');
        const b = new VendoredPCRE('(\\d+)/(\\d+) hp');
        const ra = normalize(a.match(line));
        const rb = normalize(b.match(line));
        expect(ra?.groups[1].match).toBe('250');
        expect(rb?.groups[1].match).toBe('30');
        expect(rb?.groups[2].match).toBe('100');
        // Re-match the first pattern after a longer line forced a buffer grow.
        const longLine = line + ' '.repeat(500) + 'extra 999 damage';
        expect(normalize(a.match(longLine))?.groups[1].match).toBe('250');
        a.destroy();
        b.destroy();
    }, 60000);
});
