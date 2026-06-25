import { describe, it, expect, beforeEach } from 'vitest';
import { feedScreenReaderLine, MAX_LINES } from '../../src/ui/output/ScreenReaderLog';
import { AnsiAwareBuffer } from '../../src/mud/text/FormatState';

// feedScreenReaderLine is the logic behind the off-screen ARIA live region the
// user's screen reader narrates: which message lines reach it, how they're
// flattened to plain text, and the eviction cap. Tested directly against a
// detached region element (no React), matching the suite's DOM-logic style.

let region: HTMLElement;
beforeEach(() => {
    document.body.replaceChildren();
    region = document.createElement('div');
    document.body.appendChild(region);
});

const texts = () => Array.from(region.children, c => c.textContent);

describe('feedScreenReaderLine', () => {
    it('appends a plain line and reports it appended', () => {
        expect(feedScreenReaderLine(region, 'You see a goblin.')).toBe(true);
        expect(texts()).toEqual(['You see a goblin.']);
    });

    it('strips ANSI from a raw string before announcing', () => {
        // Raw strings carry SGR escapes; the screen reader must hear only words.
        feedScreenReaderLine(region, '\x1b[31mred\x1b[0m alert');
        expect(texts()).toEqual(['red alert']);
    });

    it('reads .text from an AnsiAwareBuffer payload', () => {
        // 'message' can arrive already buffered; use its plain text, not [object].
        feedScreenReaderLine(region, new AnsiAwareBuffer('\x1b[32mgreen\x1b[0m'));
        expect(texts()).toEqual(['green']);
    });

    it('skips interim script-partial lines (superseded by the finalized line)', () => {
        expect(feedScreenReaderLine(region, 'half a cech', 'script-partial')).toBe(false);
        expect(region.childElementCount).toBe(0);
    });

    it('announces a normal typed line (only script-partial is skipped)', () => {
        expect(feedScreenReaderLine(region, 'hello', 'echo')).toBe(true);
        expect(texts()).toEqual(['hello']);
    });

    it('skips missing text', () => {
        expect(feedScreenReaderLine(region, undefined)).toBe(false);
        expect(region.childElementCount).toBe(0);
    });

    it('skips blank / whitespace-only lines (no speech, only node churn)', () => {
        expect(feedScreenReaderLine(region, '')).toBe(false);
        expect(feedScreenReaderLine(region, '   \t  ')).toBe(false);
        // ANSI-only strings flatten to blank too.
        expect(feedScreenReaderLine(region, '\x1b[1m\x1b[0m')).toBe(false);
        expect(region.childElementCount).toBe(0);
    });

    it('caps the region at MAX_LINES, evicting the oldest', () => {
        for (let i = 1; i <= MAX_LINES + 10; i++) feedScreenReaderLine(region, `line ${i}`);
        expect(region.childElementCount).toBe(MAX_LINES);
        // Oldest 10 evicted: first kept is line 11, last is the newest.
        expect(region.firstElementChild?.textContent).toBe('line 11');
        expect(region.lastElementChild?.textContent).toBe(`line ${MAX_LINES + 10}`);
    });
});
