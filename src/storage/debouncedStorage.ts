/**
 * Web-Storage-shaped adapter that coalesces rapid `setItem` calls into one
 * write after `delayMs` of quiet. The persisted blob is large (every
 * connection's scripts/triggers/timers/packages in one key) and stringifying
 * + writing it on the main thread costs tens of ms; without coalescing, a
 * single name-based `enableTrigger` over N matches triggers N full writes.
 *
 * The latest pending value is flushed on `pagehide` / `visibilitychange→hidden`
 * / `beforeunload` so a tab close right after a mutation doesn't lose state.
 * `getItem` returns the pending value if one exists so callers reading back
 * during the debounce window see the freshest state (zustand's persist itself
 * only reads on rehydrate, but this keeps the adapter independently correct).
 */
export function createDebouncedLocalStorage(delayMs: number): Storage {
    const pending = new Map<string, string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        for (const [key, value] of pending) {
            try { localStorage.setItem(key, value); }
            catch (e) { console.warn('[persist] setItem failed for', key, e); }
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
        get length(): number { return localStorage.length; },
        key: (i: number) => localStorage.key(i),
        getItem: (name: string): string | null => {
            const p = pending.get(name);
            return p !== undefined ? p : localStorage.getItem(name);
        },
        setItem: (name: string, value: string): void => {
            pending.set(name, value);
            if (timer === null) {
                timer = setTimeout(() => {
                    timer = null;
                    flush();
                }, delayMs);
            }
        },
        removeItem: (name: string): void => {
            pending.delete(name);
            localStorage.removeItem(name);
        },
        clear: (): void => {
            pending.clear();
            if (timer !== null) { clearTimeout(timer); timer = null; }
            localStorage.clear();
        },
    };
}
