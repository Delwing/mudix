import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Build-time constants injected into the bundle via Vite `define`, shared by
 * the app build, the library build and the vitest run so they can't disagree.
 *
 * Why `define` and not an import: `src/` can't read package.json directly —
 * tsconfig.lib.json pins `rootDir: "src"`, so a `../package.json` import breaks
 * the declaration emit. Substituting at build time keeps the version in exactly
 * one place (package.json) while `src/version.ts` stays inside rootDir.
 *
 * For the published library these are baked in at *publish* time, which is what
 * you want: a consumer reports the version and commit of the lib they installed.
 */

const repoRoot = new URL('.', import.meta.url);

function packageVersion(): string {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', repoRoot)), 'utf8'));
    return pkg.version;
}

/** Short HEAD hash, or '' when git can't answer — an npm tarball install, a
 *  shallow CI image, or a source zip has no repo. Callers must tolerate ''. */
function gitCommit(): string {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: fileURLToPath(repoRoot),
            stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
    } catch {
        return '';
    }
}

export function buildDefine(): Record<string, string> {
    return {
        __APP_VERSION__: JSON.stringify(packageVersion()),
        __GIT_COMMIT__: JSON.stringify(gitCommit()),
    };
}
