import { useCallback, useEffect, useState } from 'react';
import { addToHistory as addImpl, loadHistory, saveHistory } from './commandHistory';

/** Reactive MRU command history wrapper around localStorage. */
export function useCommandHistory() {
    const [history, setHistory] = useState<string[]>(() => loadHistory());

    const add = useCallback((item: string) => {
        if (!item) return;
        setHistory(prev => {
            const next = addImpl(prev, item);
            saveHistory(next);
            return next;
        });
    }, []);

    // Stay in sync when another tab edits history.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'cmd.history') setHistory(loadHistory());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    return { history, add };
}
