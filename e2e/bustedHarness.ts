import { type Page } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shared harness for Mudlet's busted *_spec.lua suite, run against the real mudix
// app in a browser. Imported by both busted.spec.ts (the per-test suite + drift
// guard + scoreboard) and genBustedManifest.ts (the manifest generator).

export type BustedFailure = { spec: string; name: string; message: string; trace?: string };
export type BustedTest = { spec: string; name: string; status: string; message?: string };
export type BustedResults = {
    total: number; passed: number; failed: number; errors: number; pending: number;
    failures: BustedFailure[];
    tests: BustedTest[];
};

// Every spec bundled in src/scripting/lua/specs/ (the full Mudlet suite).
export const ALL_SPECS = [
    'StringUtils', 'TableUtils', 'DateTime', 'GMCP', 'Regex', 'IDManager',
    'DebugTools', 'Miscallaneous', 'Other', 'DB', 'MudletBusted',
    'Alias', 'Trigger', 'KeyBinds', 'InsertTextNewline', 'TBufferOSC',
    'TextEdit', 'GUIUtils', 'GeyserLabel', 'GeyserButton', 'GeyserStyleSheet',
    'GeyserAdjustableContainer', 'UI', 'Mapper',
] as const;

// Specs that pass fully in-app today — asserted green per-it; a regression is a
// real break. The rest are tracked as a parity backlog in docs/busted-e2e-plan.md
// (genuine Mudlet-API gaps now, not harness limits). Move names here as gaps close.
export const GREEN_SPECS = [
    'StringUtils', 'TableUtils', 'DateTime', 'GMCP', 'Miscallaneous', 'TBufferOSC',
    'GeyserLabel', 'GeyserButton', 'GeyserStyleSheet', 'GeyserAdjustableContainer',
    'KeyBinds', 'DebugTools', 'MudletBusted', 'Alias', 'Trigger', 'Regex', 'IDManager',
    'GUIUtils', 'Mapper', 'TextEdit',
] as const;

// The committed per-it manifest: { spec: [fullName, ...] }. The drift guard
// fails if a spec's live it() set diverges from this, so regenerate with
// `npm run gen:busted-manifest` whenever specs are re-synced.
export const manifestPath = fileURLToPath(new URL('./busted.manifest.json', import.meta.url));

export function loadManifest(): Record<string, string[]> {
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, string[]>;
    } catch {
        return {}; // not generated yet — per-it tests just don't materialise
    }
}

// Register the non-dialing connection (store v20) for every navigation on this
// page. The bogus ws URL + the deep-link's withConnect=false keep it from
// dialing; we only need a live profile so a LuaRuntime exists. addInitScript runs
// on every goto, so localStorage is re-seeded on each reopen().
export async function seedProfile(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.setItem('mudix_v1', JSON.stringify({
            version: 20,
            state: {
                // Mirror Mudlet's own test setup: the suite is designed to run
                // under a profile NAMED "Mudlet self-test" (DebugTools.lua keeps
                // `errorc` global only for that name) whose home dir contains
                // "mudlet" (MudletBusted_spec asserts getMudletHomeDir() does).
                // getProfileName() returns the name; getMudletHomeDir() is
                // /profiles/<id>, so the id carries the "mudlet" substring.
                connections: [{
                    id: 'mudlet-self-test',
                    name: 'Mudlet self-test',
                    mode: 'websocket',
                    url: 'ws://127.0.0.1:1/',
                }],
            },
        }));
    });
}

// (Re)navigate to the seeded profile and wait for a stable runtime. Also resets
// state between specs: busted insulates Lua _G but NOT mudix's JS console
// (history/partial/cursor/selection), so running specs back-to-back in one page
// leaks console content between them. A fresh navigation rebuilds runtime+console.
//
// window.__runBusted is installed at the tail of LuaRuntime.setup(), but the app
// may recreate the runtime a couple of times during initial mount (React
// StrictMode remount + the deep-link connection effect), each time resetting the
// hook — so waiting for it to merely *exist* races a soon-to-be-destroyed runtime.
// Instead poll an actual trivial run until it returns.
export async function reopen(page: Page): Promise<void> {
    await page.goto('/?profile=mudlet-self-test');
    await page.waitForFunction(
        () => {
            const fn = (window as unknown as { __runBusted?: (p: string) => { total?: number } }).__runBusted;
            if (typeof fn !== 'function') return false;
            try {
                return (fn('StringUtils').total ?? 0) > 0;
            } catch {
                return false;
            }
        },
        undefined,
        { timeout: 90_000, polling: 500 },
    );
}

// Seed + navigate a fresh page into a ready runtime.
export async function bootProfile(page: Page): Promise<void> {
    await seedProfile(page);
    await reopen(page);
}

export function runSpec(page: Page, spec: string): Promise<BustedResults> {
    return page.evaluate(
        (s) => (window as unknown as { __runBusted: (p: string) => BustedResults }).__runBusted(s),
        spec,
    );
}

export function summarize(r: BustedResults): string {
    return `${r.passed}/${r.total} passed, ${r.failed} failed, ${r.errors} errors, ${r.pending} pending`;
}

// One full run per spec, cached for the worker. The whole suite runs single-worker
// (workers:1, fullyParallel:false), so this module-scoped Map is shared across
// every test in the file: the first test for a spec boots a page and runs the
// whole spec; the rest (and the drift guard) reuse the cached results without
// touching their page. A single it() re-run in isolation just boots on cache miss.
const resultCache = new Map<string, BustedResults>();
export async function specResults(page: Page, spec: string): Promise<BustedResults> {
    const cached = resultCache.get(spec);
    if (cached) return cached;
    await bootProfile(page);
    const r = await runSpec(page, spec);
    resultCache.set(spec, r);
    return r;
}
