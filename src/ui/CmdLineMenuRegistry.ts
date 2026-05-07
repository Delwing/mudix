export interface CmdLineMenuEntry {
    /** Stable id used by removeCommandLineMenuEvent. */
    uniqueName: string;
    /** Event name passed to raiseEvent on click. */
    eventName: string;
    /** Label rendered in the context menu. Defaults to uniqueName. */
    displayName: string;
}

/**
 * Backs Mudlet's addCommandLineMenuEvent / removeCommandLineMenuEvent /
 * getCommandLineMenuEvents. Right-clicking the command bar shows entries from
 * this registry; clicking one raises the registered event with the current
 * command-line text as the first argument.
 */
export class CmdLineMenuRegistry {
    private entries = new Map<string, CmdLineMenuEntry>();
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

    add(uniqueName: string, eventName: string, displayName?: string): boolean {
        if (!uniqueName || !eventName) return false;
        this.entries.set(uniqueName, {
            uniqueName,
            eventName,
            displayName: displayName && displayName.length > 0 ? displayName : uniqueName,
        });
        this.notify();
        return true;
    }

    remove(uniqueName: string): boolean {
        const ok = this.entries.delete(uniqueName);
        if (ok) this.notify();
        return ok;
    }

    list(): CmdLineMenuEntry[] {
        return [...this.entries.values()];
    }

    /** Raise the entry's event, passing the current command-line text. */
    dispatch(uniqueName: string, cmdLineText: string): void {
        const entry = this.entries.get(uniqueName);
        if (!entry) return;
        this.dispatcher?.(entry.eventName, [cmdLineText]);
    }
}
