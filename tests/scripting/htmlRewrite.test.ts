import { describe, it, expect } from 'vitest';
import { rewriteVfsUrlsInHtml } from '../../src/scripting/vfs/htmlRewrite';
import { rewriteVfsUrlsInCss } from '../../src/scripting/vfs/cssRewrite';
import type { ProfileVFS } from '../../src/scripting/vfs/ProfileVFS';

/**
 * Mudlet renders `echo(labelName, html)` as Qt rich text, so packages embed
 * `<img src="<getMudletHomeDir()>/Pkg/icon.png">` and Qt loads it straight off
 * disk. In the browser those bytes only exist inside the profile VFS, reachable
 * through the service worker at /__vfs/<connectionId>/<path> — without the
 * rewrite the raw path escapes to the origin and decodes as a broken image
 * (on the dev server it resolves to the SPA fallback index.html, status 200,
 * content-type text/html). This pins the rebasing rules.
 */

/** Minimal ProfileVFS stand-in: only resolvePath/profilePath are consulted. */
const vfs = {
    profilePath: '/profiles/conn1',
    resolvePath(p: string): string {
        return p.startsWith('/') ? p : `/profiles/conn1/${p}`;
    },
} as unknown as ProfileVFS;

const rewrite = (html: string) => rewriteVfsUrlsInHtml(html, 'conn1', vfs);

describe('rewriteVfsUrlsInHtml', () => {
    it('rebases an absolute profile path onto the service-worker prefix', () => {
        expect(rewrite('<img src="/profiles/conn1/StickMUD/001-amulet.png" width="24">'))
            .toBe('<img src="/__vfs/conn1/StickMUD/001-amulet.png" width="24">');
    });

    it('rebases a profile-relative path', () => {
        expect(rewrite('<img src="StickMUD/icon.png">'))
            .toBe('<img src="/__vfs/conn1/StickMUD/icon.png">');
    });

    it('handles single-quoted and unquoted attribute values', () => {
        expect(rewrite("<img src='a/b.png'>")).toBe('<img src="/__vfs/conn1/a/b.png">');
        expect(rewrite('<img src=a/b.png>')).toBe('<img src="/__vfs/conn1/a/b.png">');
    });

    it('leaves absolute and already-rewritten references untouched', () => {
        for (const src of [
            'https://example.com/x.png',
            'http://example.com/x.png',
            'data:image/png;base64,AAAA',
            'blob:http://localhost/abcd',
            '/__vfs/conn1/x.png',
        ]) {
            const html = `<img src="${src}">`;
            expect(rewrite(html)).toBe(html);
        }
    });

    it('rewrites url(...) inside an inline style attribute', () => {
        expect(rewrite('<div style="background-image: url(bg.png)">x</div>'))
            .toBe('<div style="background-image: url(&quot;/__vfs/conn1/bg.png&quot;)">x</div>');
    });

    it('leaves href alone — label links are navigation targets, not resources', () => {
        const html = '<a href="local/page.html">go</a>';
        expect(rewrite(html)).toBe(html);
    });

    it('does not touch text content that merely looks like an attribute', () => {
        const html = '<span>write src="foo.png" to embed</span>';
        expect(rewrite(html)).toBe(html);
    });

    it('does not end a tag early on a > inside a quoted attribute', () => {
        expect(rewrite('<img alt="a > b" src="x.png">'))
            .toBe('<img alt="a > b" src="/__vfs/conn1/x.png">');
    });

    it('preserves self-closing tags', () => {
        expect(rewrite('<img src="x.png"/>')).toBe('<img src="/__vfs/conn1/x.png"/>');
    });

    it('rewrites every image in a multi-image label body', () => {
        const out = rewrite('<center><img src="a.png"><img src="b.png"></center>');
        expect(out).toBe('<center><img src="/__vfs/conn1/a.png"><img src="/__vfs/conn1/b.png"></center>');
    });

    it('percent-encodes path segments the same way the CSS rewriter does', () => {
        // Both surfaces must agree, or the SW cache keys diverge for one asset.
        const fromHtml = /src="([^"]*)"/.exec(rewrite('<img src="my dir/a b.png">'))![1];
        const fromCss = /url\("([^"]*)"\)/.exec(
            rewriteVfsUrlsInCss('a { background: url("my dir/a b.png") }', 'conn1', vfs),
        )![1];
        expect(fromHtml).toBe(fromCss);
    });

    it('returns plain text and empty input unchanged', () => {
        expect(rewrite('')).toBe('');
        expect(rewrite('just text')).toBe('just text');
    });
});
