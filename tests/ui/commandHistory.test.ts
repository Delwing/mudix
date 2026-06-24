import { describe, it, expect, beforeEach } from 'vitest';
import { saveHistory, loadHistory, addToHistory, historyStorageKey, DEFAULT_HISTORY_SAVE_SIZE, MAX_HISTORY } from '../../src/ui/commandHistory';

const KEY = historyStorageKey('conn-a');

describe('command history save cap', () => {
    beforeEach(() => localStorage.clear());

    it('defaults the save size to MAX_HISTORY', () => {
        expect(DEFAULT_HISTORY_SAVE_SIZE).toBe(MAX_HISTORY);
    });

    it('persists at most `saveSize` entries', () => {
        const items = Array.from({ length: 20 }, (_, i) => `cmd${i}`);
        saveHistory(items, KEY, 5);
        expect(loadHistory(KEY)).toEqual(items.slice(0, 5));
    });

    it('keeps the most-recent entries (MRU order is preserved)', () => {
        let h: string[] = [];
        for (const c of ['a', 'b', 'c', 'd']) h = addToHistory(h, c);
        // addToHistory unshifts, so 'd' is newest.
        saveHistory(h, KEY, 2);
        expect(loadHistory(KEY)).toEqual(['d', 'c']);
    });

    it('treats a negative save size as no cap', () => {
        const items = ['a', 'b', 'c'];
        saveHistory(items, KEY, -1);
        expect(loadHistory(KEY)).toEqual(items);
    });

    it('does not truncate when fewer items than the cap', () => {
        const items = ['a', 'b'];
        saveHistory(items, KEY, 10);
        expect(loadHistory(KEY)).toEqual(items);
    });
});

describe('per-profile history isolation', () => {
    beforeEach(() => localStorage.clear());

    it('derives a distinct storage key per connection', () => {
        expect(historyStorageKey('conn-a')).not.toBe(historyStorageKey('conn-b'));
        // No connection (connection screen) falls back to a stable bare key.
        expect(historyStorageKey(null)).toBe(historyStorageKey(null));
        expect(historyStorageKey(null)).not.toBe(historyStorageKey('conn-a'));
    });

    it('does not share history between profiles', () => {
        const a = historyStorageKey('conn-a');
        const b = historyStorageKey('conn-b');
        saveHistory(['north', 'south'], a);
        saveHistory(['cast fireball'], b);
        expect(loadHistory(a)).toEqual(['north', 'south']);
        expect(loadHistory(b)).toEqual(['cast fireball']);
    });
});
