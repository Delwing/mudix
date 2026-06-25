import { describe, it, expect, beforeEach } from 'vitest';
import {
    matchCaretToggle,
    outputLineElements,
    cloneOutputLine,
    isNearBottom,
    type CaretShortcut,
} from '../../src/ui/output/caretMode';

// Build a minimal KeyboardEvent-shaped object — matchCaretToggle reads only
// `key` and the modifier flags.
function kev(key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}): KeyboardEvent {
    return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods } as unknown as KeyboardEvent;
}

describe('matchCaretToggle', () => {
    it("'tab' matches a bare Tab and nothing modified", () => {
        expect(matchCaretToggle(kev('Tab'), 'tab')).toBe(true);
        expect(matchCaretToggle(kev('Tab', { ctrlKey: true }), 'tab')).toBe(false);
        expect(matchCaretToggle(kev('Tab', { shiftKey: true }), 'tab')).toBe(false);
        expect(matchCaretToggle(kev('Tab', { altKey: true }), 'tab')).toBe(false);
    });

    it("'ctrltab' matches Ctrl+Tab only", () => {
        expect(matchCaretToggle(kev('Tab', { ctrlKey: true }), 'ctrltab')).toBe(true);
        expect(matchCaretToggle(kev('Tab'), 'ctrltab')).toBe(false);
        expect(matchCaretToggle(kev('Tab', { ctrlKey: true, shiftKey: true }), 'ctrltab')).toBe(false);
    });

    it("'f6' matches a bare F6 only", () => {
        expect(matchCaretToggle(kev('F6'), 'f6')).toBe(true);
        expect(matchCaretToggle(kev('F6', { ctrlKey: true }), 'f6')).toBe(false);
        expect(matchCaretToggle(kev('Tab'), 'f6')).toBe(false);
    });

    it("'none' (and unknown) never match", () => {
        expect(matchCaretToggle(kev('Tab'), 'none')).toBe(false);
        expect(matchCaretToggle(kev('F6'), 'none')).toBe(false);
        expect(matchCaretToggle(kev('Tab'), 'bogus' as CaretShortcut)).toBe(false);
    });
});

let root: HTMLElement;
beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
});

function outputLine(html: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'output-msg';
    el.innerHTML = `<div class="output-msg-text"><span class="output-msg-content">${html}</span></div>`;
    return el;
}

describe('outputLineElements', () => {
    it('returns the .output-msg children in order, skipping the sentinel and others', () => {
        const a = outputLine('a'), b = outputLine('b');
        const sentinel = document.createElement('div'); // height:0 sticky sentinel — no .output-msg
        root.append(a, sentinel, b);
        expect(outputLineElements(root)).toEqual([a, b]);
    });

    it('returns [] when there are no rendered lines', () => {
        expect(outputLineElements(root)).toEqual([]);
    });
});

describe('cloneOutputLine', () => {
    it('preserves the line text', () => {
        const orig = outputLine('You see a goblin.');
        root.appendChild(orig);
        const clone = cloneOutputLine(orig);
        expect(clone.textContent).toContain('You see a goblin.');
    });

    it("revives links: the clone's click re-dispatches to the original element", () => {
        const orig = outputLine('go <span data-output-clickable tabindex="-1">north</span>');
        root.appendChild(orig);
        let fired = 0;
        orig.querySelector<HTMLElement>('[data-output-clickable]')!.addEventListener('click', () => { fired++; });

        const clone = cloneOutputLine(orig);
        const cloneLink = clone.querySelector<HTMLElement>('[data-output-clickable]')!;
        // role=link so assistive tech announces/reaches it.
        expect(cloneLink.getAttribute('role')).toBe('link');
        // Clicking the clone activates the ORIGINAL link's real action.
        cloneLink.click();
        expect(fired).toBe(1);
    });

    it('pairs multiple links by index', () => {
        const orig = outputLine(
            '<span data-output-clickable tabindex="-1">n</span> <span data-output-clickable tabindex="-1">s</span>',
        );
        root.appendChild(orig);
        const origLinks = orig.querySelectorAll<HTMLElement>('[data-output-clickable]');
        const hits = [0, 0];
        origLinks[0].addEventListener('click', () => { hits[0]++; });
        origLinks[1].addEventListener('click', () => { hits[1]++; });

        const clone = cloneOutputLine(orig);
        const cloneLinks = clone.querySelectorAll<HTMLElement>('[data-output-clickable]');
        cloneLinks[1].click();
        expect(hits).toEqual([0, 1]); // only the second original fired
    });

    it('clones a line with no links without error', () => {
        const orig = outputLine('plain line');
        root.appendChild(orig);
        const clone = cloneOutputLine(orig);
        expect(clone.querySelectorAll('[data-output-clickable]')).toHaveLength(0);
        expect(clone.textContent).toContain('plain line');
    });
});

describe('isNearBottom', () => {
    const fake = (scrollHeight: number, scrollTop: number, clientHeight: number) =>
        ({ scrollHeight, scrollTop, clientHeight }) as unknown as HTMLElement;

    it('is true at/near the bottom (within threshold)', () => {
        expect(isNearBottom(fake(1000, 968, 32))).toBe(true); // exactly at bottom
        expect(isNearBottom(fake(1000, 940, 32))).toBe(true); // 28px from bottom ≤ 32
    });

    it('is false when scrolled up past the threshold', () => {
        expect(isNearBottom(fake(1000, 0, 32))).toBe(false);
        expect(isNearBottom(fake(1000, 900, 32))).toBe(false); // 68px from bottom > 32
    });

    it('honors a custom threshold', () => {
        expect(isNearBottom(fake(1000, 900, 32), 100)).toBe(true); // 68 ≤ 100
    });
});
