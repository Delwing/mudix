import { defineConfig, devices } from '@playwright/test';

// Single execution path for Mudlet's busted suite: drive the REAL mudix app in a
// browser (not the node thin-layer), so the full ScriptingEngine — trigger/alias
// dispatch, timer pump, overlay/Geyser geometry — is wired exactly as in
// production. The dev server runs with VITE_BUSTED=1 (via `vite --mode busted`),
// which bundles the spec corpus and exposes window.__runBusted. See
// docs/busted-e2e-plan.md.
export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    // ~1.5s VFS mount + wasmoon init + bundled-Lua load per page, plus the suite.
    timeout: 120_000,
    reporter: process.env.CI
        ? [['junit', { outputFile: 'playwright-report/results.xml' }], ['list']]
        : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://localhost:5174',
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    // Dedicated port 5174 (not the default 5173 `npm run dev` uses): with
    // reuseExistingServer on, this guarantees we only ever reuse a busted-mode
    // server, never a developer's plain dev server that lacks VITE_BUSTED.
    webServer: {
        command: 'npm run dev:busted',
        url: 'http://localhost:5174',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
