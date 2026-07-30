// Re-sync the Mudlet busted spec corpus (`src/scripting/lua/specs/*_spec.lua`)
// from upstream Mudlet.
//
// The specs are kept byte-for-byte identical to Mudlet's own
// `src/mudlet-lua/tests/`, so a failing spec is always a genuine mudix↔Mudlet
// parity gap and never local drift (see specs/SYNCED.md). This script is the
// "clean copy + diff" that provenance note describes: it pins a commit, pulls
// every `*_spec.lua` verbatim, reports what changed, and rewrites the SYNCED.md
// header so the recorded hash can't fall out of step with the files.
//
//   yarn sync:mudlet-specs                 # from GitHub, development branch
//   yarn sync:mudlet-specs --dry-run       # report only, touch nothing
//   yarn sync:mudlet-specs --ref v4.20.0   # any branch/tag/sha
//   yarn sync:mudlet-specs --from E:/Code/Mudlet [--fetch]   # local checkout
//
// Nothing downstream needs maintenance: bustedHarness.ts discovers specs from
// disk and LuaRuntime.ts bundles them with import.meta.glob, so a brand-new
// `Foo_spec.lua` shows up in the e2e suite on its own. The per-it() manifest
// does need regenerating — the drift guard in busted.spec.ts fails until then,
// and this script says so on exit.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'Mudlet/Mudlet';
const UPSTREAM_DIR = 'src/mudlet-lua/tests';
const SPECS_DIR = fileURLToPath(new URL('../src/scripting/lua/specs/', import.meta.url));
const SYNCED_MD = `${SPECS_DIR}SYNCED.md`;

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) die(`${name} needs a value`);
    return v;
};
const ref = opt('--ref', 'development');
const localRepo = opt('--from', null);
const dryRun = flag('--dry-run');
const doFetch = flag('--fetch');
const keepRemoved = flag('--keep-removed');

function die(msg) {
    console.error(`sync-mudlet-specs: ${msg}`);
    process.exit(1);
}

// Git blobs are LF; on Windows a checkout with core.autocrlf=true leaves CRLF in
// the working tree. Normalise both sides before comparing (and always write LF)
// so "unchanged" means unchanged upstream, not "checked out on another OS".
const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

// ── sources ──────────────────────────────────────────────────────────────────
// Each source resolves `ref` to a concrete commit up front and reads every file
// at that sha, so a push mid-run can't produce a half-old/half-new corpus.

function localSource(repoPath) {
    const git = (...args) => execFileSync('git', ['-C', repoPath, ...args], { maxBuffer: 1 << 28 });
    const gitText = (...args) => git(...args).toString('utf8').trim();

    if (doFetch) {
        console.log(`Fetching ${ref} in ${repoPath} …`);
        execFileSync('git', ['-C', repoPath, 'fetch', 'origin', ref], { stdio: 'inherit' });
    }
    // Prefer the remote-tracking ref: a local `development` in a checkout that's
    // been sitting around is usually staler than origin's.
    let sha = null;
    for (const candidate of [`origin/${ref}`, ref]) {
        try {
            sha = gitText('rev-parse', '--verify', '--quiet', `${candidate}^{commit}`);
            if (sha) break;
        } catch { /* try the next candidate */ }
    }
    if (!sha) die(`ref "${ref}" not found in ${repoPath} (try --fetch)`);

    const date = gitText('log', '-1', '--format=%cs', sha);
    const files = gitText('ls-tree', '-r', '--name-only', sha, `${UPSTREAM_DIR}/`)
        .split('\n')
        .map(p => p.slice(UPSTREAM_DIR.length + 1))
        .filter(p => p.endsWith('_spec.lua'))
        .sort();
    if (files.length === 0) die(`no *_spec.lua under ${UPSTREAM_DIR} at ${sha.slice(0, 8)}`);

    return {
        origin: repoPath, sha, date, files,
        read: (name) => git('show', `${sha}:${UPSTREAM_DIR}/${name}`),
    };
}

async function githubSource() {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'mudix-sync-specs' };
    // Unauthenticated is 60 requests/hour and this makes two — a token is only
    // needed on a shared/CI IP that's already burned through the budget.
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const api = async (url) => {
        const res = await fetch(url, { headers });
        if (!res.ok) {
            die(`GitHub ${res.status} ${res.statusText} for ${url}`
                + (res.status === 403 ? ' — rate limited; set GITHUB_TOKEN or use --from <checkout>' : ''));
        }
        return res.json();
    };

    console.log(`Resolving ${REPO}@${ref} …`);
    const commit = await api(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`);
    const sha = commit.sha;
    const date = (commit.commit?.committer?.date ?? '').slice(0, 10);
    const tree = await api(`https://api.github.com/repos/${REPO}/contents/${UPSTREAM_DIR}?ref=${sha}`);
    const files = tree
        .filter(e => e.type === 'file' && e.name.endsWith('_spec.lua'))
        .map(e => e.name)
        .sort();
    if (files.length === 0) die(`no *_spec.lua under ${UPSTREAM_DIR} at ${sha.slice(0, 8)}`);

    return {
        origin: `https://github.com/${REPO}`, sha, date, files,
        read: async (name) => {
            const url = `https://raw.githubusercontent.com/${REPO}/${sha}/${UPSTREAM_DIR}/${name}`;
            const res = await fetch(url);
            if (!res.ok) die(`download failed (${res.status}) for ${name}`);
            return Buffer.from(await res.arrayBuffer());
        },
    };
}

// ── sync ─────────────────────────────────────────────────────────────────────
const source = localRepo ? localSource(localRepo) : await githubSource();
console.log(`Source: ${source.origin} @ ${source.sha.slice(0, 8)} (${source.date}), `
    + `${source.files.length} spec file(s)\n`);

mkdirSync(SPECS_DIR, { recursive: true });
const localFiles = new Set(readdirSync(SPECS_DIR).filter(f => f.endsWith('_spec.lua')));

const added = [], updated = [], unchanged = [];
for (const name of source.files) {
    const next = lf(await source.read(name));
    const dest = `${SPECS_DIR}${name}`;
    let prev = null;
    try { prev = lf(readFileSync(dest)); } catch { /* new file */ }

    if (prev && prev.equals(next)) {
        unchanged.push(name);
    } else {
        (prev ? updated : added).push(prev ? `${name} (${sizeDelta(prev, next)})` : name);
        if (!dryRun) writeFileSync(dest, next);
    }
    localFiles.delete(name);
}

// Left over locally = gone upstream. Deleted by default: the corpus is a mirror,
// and a spec Mudlet retired shouldn't keep gating the e2e suite here.
const removed = [...localFiles].sort();
if (!dryRun && !keepRemoved) for (const name of removed) rmSync(`${SPECS_DIR}${name}`);

function sizeDelta(prev, next) {
    const d = next.toString().split('\n').length - prev.toString().split('\n').length;
    return d === 0 ? 'edited' : d > 0 ? `+${d} lines` : `${d} lines`;
}

// ── SYNCED.md ────────────────────────────────────────────────────────────────
if (!dryRun) {
    const md = readFileSync(SYNCED_MD, 'utf8');
    const next = md
        .replace(
            /^- Synced from commit: .*$/m,
            `- Synced from commit: \`${source.sha}\` (${ref}, ${source.date})`,
        )
        .replace(
            /^All \d+ `\*_spec\.lua` files/m,
            `All ${source.files.length} \`*_spec.lua\` files`,
        );
    if (next === md && (updated.length || added.length || removed.length)) {
        console.warn('! SYNCED.md header not recognised — update the commit hash by hand.\n');
    }
    writeFileSync(SYNCED_MD, next);
}

// ── report ───────────────────────────────────────────────────────────────────
const list = (label, items) => {
    if (!items.length) return;
    console.log(`${label} (${items.length}):`);
    for (const i of items) console.log(`  ${i}`);
};
list('Added', added);
list('Updated', updated);
list(keepRemoved ? 'Gone upstream (kept)' : 'Removed', removed);
console.log(`Unchanged: ${unchanged.length}`);

const changed = added.length + updated.length + removed.length;
if (dryRun) {
    console.log(`\nDry run — nothing written. ${changed} file(s) would change.`);
} else if (changed) {
    console.log('\nNext:');
    console.log('  yarn dev:busted            # serve the app with the spec corpus bundled');
    console.log('  yarn gen:busted-manifest   # re-record the per-it() manifest (drift guard fails until you do)');
    console.log('  yarn test:e2e              # run the corpus against the real app');
} else {
    console.log('\nAlready up to date.');
}
