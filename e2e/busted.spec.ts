import { test, expect, type Page } from '@playwright/test';

// Mudlet's busted *_spec.lua suite, run against the real mudix app in a browser.
// This is the single path for the whole corpus: because the live app wires the
// full ScriptingEngine (trigger/alias dispatch, timer pump) and renders real
// overlay/Geyser geometry, specs the node thin-layer couldn't exercise (triggers
// via feedTriggers, DOM-dependent widgets) run here too.

type BustedFailure = { spec: string; name: string; message: string; trace?: string };
type BustedResults = {
    total: number; passed: number; failed: number; errors: number; pending: number;
    failures: BustedFailure[];
};

// Every spec bundled in src/scripting/lua/specs/ (the full Mudlet suite).
const ALL_SPECS = [
    'StringUtils', 'TableUtils', 'DateTime', 'GMCP', 'Regex', 'IDManager',
    'DebugTools', 'Miscallaneous', 'Other', 'DB', 'MudletBusted',
    'Alias', 'Trigger', 'KeyBinds', 'InsertTextNewline', 'TBufferOSC',
    'TextEdit', 'GUIUtils', 'GeyserLabel', 'GeyserButton', 'GeyserStyleSheet',
    'GeyserAdjustableContainer', 'UI', 'Mapper', 'Debug',
] as const;

// Specs that pass fully in-app today — asserted green; a regression is a real
// break. The rest are tracked as a parity backlog in docs/busted-e2e-plan.md
// (genuine Mudlet-API gaps now, not harness limits). Move names here as gaps close.
const GREEN_SPECS = [
    'StringUtils', 'TableUtils', 'DateTime', 'GMCP', 'Miscallaneous', 'TBufferOSC',
    'GeyserLabel', 'GeyserButton', 'GeyserStyleSheet', 'GeyserAdjustableContainer',
    'KeyBinds', 'DebugTools', 'MudletBusted', 'Alias', 'Trigger', 'Regex', 'IDManager',
    'GUIUtils',
] as const;

// Seed a non-dialing connection into localStorage (store v20) before any app JS
// runs, then deep-link into it. The bogus ws URL + deep-link's withConnect=false
// keep it from dialing; we only need a live profile so a LuaRuntime exists.
async function bootProfile(page: Page): Promise<void> {
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
    await reopen(page);
}

// (Re)navigate to the seeded profile and wait for a stable runtime. Also used to
// reset state between specs: busted insulates Lua _G but NOT mudix's JS console
// (history/partial/cursor/selection), so running specs back-to-back in one page
// leaks console content between them (e.g. a trigger spec's leftover lines break
// a later selectAll). A fresh navigation rebuilds the runtime + console clean.
//
// window.__runBusted is installed at the tail of LuaRuntime.setup(), but the app
// may recreate the runtime a couple of times during initial mount (React
// StrictMode remount + the deep-link connection effect), each time resetting the
// hook — so waiting for it to merely *exist* races a soon-to-be-destroyed
// runtime. Instead poll an actual trivial run until it returns.
async function reopen(page: Page): Promise<void> {
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

function runSpec(page: Page, spec: string): Promise<BustedResults> {
    return page.evaluate(
        (s) => (window as unknown as { __runBusted: (p: string) => BustedResults }).__runBusted(s),
        spec,
    );
}

function summarize(r: BustedResults): string {
    return `${r.passed}/${r.total} passed, ${r.failed} failed, ${r.errors} errors, ${r.pending} pending`;
}

test.describe('Mudlet busted suite (in-app)', () => {
    test.beforeEach(async ({ page }) => {
        await bootProfile(page);
    });

    for (const spec of GREEN_SPECS) {
        test(`${spec}_spec passes fully against mudix`, async ({ page }) => {
            const r = await runSpec(page, spec);
            if (r.failed > 0 || r.errors > 0) {
                const detail = r.failures
                    .map(f => `  ✗ ${f.name || f.spec}\n      ${String(f.message).split('\n')[0]}`)
                    .join('\n');
                throw new Error(`${spec}_spec regressed: ${summarize(r)}\n${detail}`);
            }
            expect(r.total).toBeGreaterThan(0);
            expect(r.failed).toBe(0);
            expect(r.errors).toBe(0);
        });
    }

    // Robustness + visibility: run every bundled spec through the in-process
    // runner (must not crash it) and print the live pass counts, so the parity
    // backlog stays visible without hard-failing on known gaps.
    test('runs every bundled spec without crashing the runner', async ({ page }) => {
        const board: string[] = [];
        for (const spec of ALL_SPECS) {
            // Fresh page per spec so mudix's console state doesn't leak between
            // specs (busted only insulates Lua _G), keeping the counts accurate.
            await reopen(page);
            const r = await runSpec(page, spec);
            expect(r, `${spec}: no results`).toBeTruthy();
            expect(r.total, `${spec}: no tests executed`).toBeGreaterThan(0);
            const mark = r.failed === 0 && r.errors === 0 ? '✓' : '✗';
            board.push(`  ${mark} ${spec.padEnd(14)} ${summarize(r)}`);
            for (const f of r.failures.slice(0, 8)) {
                board.push(`        · ${f.name || f.spec}: ${String(f.message).split('\n')[0].slice(0, 120)}`);
            }
        }
        console.log('\n[busted in-app scoreboard]\n' + board.join('\n'));
    });
});
