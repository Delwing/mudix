import { test } from '@playwright/test';
import fs from 'node:fs';
import {
    GREEN_SPECS, seedProfile, reopen, runSpec, manifestPath,
} from './bustedHarness';

// Manifest generator for the per-test busted suite. Run via its own config so it
// never runs as part of the normal suite:  `npm run gen:busted-manifest`.
//
// It drives the real app once per green spec, collects every it()'s full name,
// and writes e2e/busted.manifest.json — the static list busted.spec.ts reads at
// collection time to register one Playwright test() per Mudlet it(). Regenerate
// whenever the spec corpus is re-synced or a spec joins GREEN_SPECS; the drift
// guard in busted.spec.ts fails until you do.
test('generate busted manifest', async ({ page }) => {
    await seedProfile(page);
    const manifest: Record<string, string[]> = {};
    let totalTests = 0;
    for (const spec of GREEN_SPECS) {
        await reopen(page); // fresh console per spec; addInitScript re-seeds
        const r = await runSpec(page, spec);
        manifest[spec] = r.tests.map(t => t.name);
        totalTests += r.tests.length;
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    test.info().annotations.push({
        type: 'manifest',
        description: `${GREEN_SPECS.length} specs, ${totalTests} tests → ${manifestPath}`,
    });
});
