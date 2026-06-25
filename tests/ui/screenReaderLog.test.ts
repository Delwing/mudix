import { describe, it, expect, beforeEach } from 'vitest';
import { screenReaderPlainText, flushScreenReaderLines } from '../../src/ui/output/ScreenReaderLog';
import { AnsiAwareBuffer } from '../../src/mud/text/FormatState';

// These back the off-screen ARIA live region the user's screen reader narrates:
// screenReaderPlainText decides what (if anything) a message line announces;
// flushScreenReaderLines coalesces a burst into one announcement. Tested
// directly against a detached region (no React), matching the suite's style.

describe('screenReaderPlainText', () => {
    it('returns the plain text of a normal line', () => {
        expect(screenReaderPlainText('You see a goblin.')).toBe('You see a goblin.');
    });

    it('strips ANSI from a raw string', () => {
        expect(screenReaderPlainText('\x1b[31mred\x1b[0m alert')).toBe('red alert');
    });

    it('reads .text from an AnsiAwareBuffer payload', () => {
        expect(screenReaderPlainText(new AnsiAwareBuffer('\x1b[32mgreen\x1b[0m'))).toBe('green');
    });

    it('skips interim script-partial lines (superseded by the finalized line)', () => {
        expect(screenReaderPlainText('half a cech', 'script-partial')).toBeNull();
    });

    it('keeps a normal typed line (only script-partial is skipped)', () => {
        expect(screenReaderPlainText('hello', 'echo')).toBe('hello');
    });

    it('skips missing text', () => {
        expect(screenReaderPlainText(undefined)).toBeNull();
    });

    it('skips blank / whitespace-only / ANSI-only lines', () => {
        expect(screenReaderPlainText('')).toBeNull();
        expect(screenReaderPlainText('   \t  ')).toBeNull();
        expect(screenReaderPlainText('\x1b[1m\x1b[0m')).toBeNull();
    });
});

let region: HTMLElement;
beforeEach(() => {
    document.body.replaceChildren();
    region = document.createElement('div');
    document.body.appendChild(region);
});

describe('flushScreenReaderLines', () => {
    it('appends a burst as ONE batch node with a child per line', () => {
        expect(flushScreenReaderLines(region, ['line a', 'line b', 'line c'])).toBe(true);
        // One direct child (the batch) → the screen reader announces it once.
        expect(region.childElementCount).toBe(1);
        const batch = region.firstElementChild!;
        expect(Array.from(batch.children, c => c.textContent)).toEqual(['line a', 'line b', 'line c']);
    });

    it('does nothing for an empty batch', () => {
        expect(flushScreenReaderLines(region, [])).toBe(false);
        expect(region.childElementCount).toBe(0);
    });

    it('caps the region at maxLines batches, evicting the oldest', () => {
        for (let i = 1; i <= 8; i++) flushScreenReaderLines(region, [`batch ${i}`], 5);
        expect(region.childElementCount).toBe(5);
        // Oldest three evicted: first kept is batch 4, last is batch 8.
        expect(region.firstElementChild?.textContent).toBe('batch 4');
        expect(region.lastElementChild?.textContent).toBe('batch 8');
    });
});
