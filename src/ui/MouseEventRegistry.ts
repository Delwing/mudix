export interface MouseEventEntry {
    /** Stable id used by removeMouseEvent and as the map key for getMouseEvents. */
    uniqueName: string;
    /** Event raised (via raiseEvent) when the menu item is clicked. */
    eventName: string;
    /** Label rendered in the context menu. Defaults to uniqueName. */
    displayName: string;
    /** Tooltip shown on hover. Empty string when none was given. */
    tooltip: string;
}

/**
 * Backs Mudlet's addMouseEvent / removeMouseEvent / getMouseEvents
 * (Host::mConsoleActions). Right-clicking the main output area shows entries
 * from this registry; clicking one raises the registered event. addMouseEvent
 * refuses a duplicate uniqueName (matching Mudlet's warn-and-return-nil).
 */
export class MouseEventRegistry {
    private entries = new Map<string, MouseEventEntry>();
    private subscribers = new Set<() => void>();
    private dispatcher: ((eventName: string, args: unknown[]) => void) | null = null;

    subscribe(cb: () => void): () => void {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
    }

    private notify(): void {
        for (const cb of this.subscribers) cb();
    }

    setDispatcher(fn: ((eventName: string, args: unknown[]) => void) | null): void {
        this.dispatcher = fn;
    }

    /** Mudlet addMouseEvent — false when uniqueName/eventName is empty or the
     *  uniqueName is already registered. */
    add(uniqueName: string, eventName: string, displayName?: string, tooltip?: string): boolean {
        if (!uniqueName || !eventName) return false;
        if (this.entries.has(uniqueName)) return false;
        this.entries.set(uniqueName, {
            uniqueName,
            eventName,
            displayName: displayName && displayName.length > 0 ? displayName : uniqueName,
            tooltip: tooltip ?? '',
        });
        this.notify();
        return true;
    }

    remove(uniqueName: string): boolean {
        const ok = this.entries.delete(uniqueName);
        if (ok) this.notify();
        return ok;
    }

    list(): MouseEventEntry[] {
        return [...this.entries.values()];
    }

    /** Raise the entry's event. Mudlet passes the originating window name. */
    dispatch(uniqueName: string): void {
        const entry = this.entries.get(uniqueName);
        if (!entry) return;
        this.dispatcher?.(entry.eventName, ['main']);
    }
}
