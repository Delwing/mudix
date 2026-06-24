import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Dedicated config for regenerating e2e/busted.manifest.json (the per-test
// suite's static it() list). Run with `npm run gen:busted-manifest`.
//
// The default config's testMatch only picks up *.spec.ts, so e2e/genBustedManifest.ts
// never runs in the normal suite. This config inverts that: it runs ONLY the
// generator, reusing the base webServer (the VITE_BUSTED dev server) and browser.
export default defineConfig({
    ...base,
    testMatch: /genBustedManifest\.ts$/,
});
