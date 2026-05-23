import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * Zustand PersistStorage adapter that coalesces rapid mutations into a single
 * write — *including* the JSON serialization step.
 *
 * Using `createJSONStorage` over a debounced Web-Storage wrapper only collapses
 * the localStorage.setItem call; zustand still runs `JSON.stringify(state)`
 * before each setItem, so N mutations cost N full serializations of the
 * persisted blob (scripts, triggers, packages, …). Implementing PersistStorage
 * directly lets us hold the unserialized object and stringify exactly once,
 * at flush time.
 *
 * The latest pending value is flushed synchronously on `pagehide`,
 * `visibilitychange→hidden`, and `beforeunload` so a tab close right after a
 * mutation doesn't lose state. `getItem` honours an in-flight pending value so
 * the adapter is internally consistent even mid-debounce.
 */
export function createDebouncedJsonStorage<S>(delayMs: number): PersistStorage<S> {
    const pending = new Map<string, StorageValue<S>>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        for (const [key, value] of pending) {
            try { localStorage.setItem(key, JSON.stringify(value)); }
            catch (e) { console.warn('[persist] write failed for', key, e); }
        }
        pending.clear();
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', flush);
        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
    }

    return {
        getItem: (name) => {
            const p = pending.get(name);
            if (p !== undefined) return p;
            const raw = localStorage.getItem(name);
            if (raw === null) return null;
            try { return JSON.parse(raw) as StorageValue<S>; }
            catch { return null; }
        },
        setItem: (name, value) => {
            pending.set(name, value);
            if (timer === null) {
                timer = setTimeout(() => { timer = null; flush(); }, delayMs);
            }
        },
        removeItem: (name) => {
            pending.delete(name);
            localStorage.removeItem(name);
        },
    };
}
