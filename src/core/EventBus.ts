type Params<T> = [T] extends [void]
    ? []
    : [T] extends [any[]]
        ? T
        : [T];
type Handler<T> = (...args: Params<T>) => void;
type ListenerEntry<T> = {
    handler: Handler<T> | false;
    once: boolean;
    cleanup?: () => void;
};

type EventOptions = {
    once?: boolean;
    signal?: AbortSignal;
};

export class EventBus<Events extends Record<PropertyKey, any>> {
    private listeners = new Map<PropertyKey, ListenerEntry<any>[]>();
    /** Number of emit() calls currently on the stack. Dead entries are only
     *  spliced out of a bucket while nothing is iterating it (depth 0); during
     *  a dispatch they stay in place, flagged `handler === false`, so indices
     *  never shift under an in-flight loop. */
    private dispatchDepth = 0;

    on<K extends keyof Events>(
        event: K,
        listener: Handler<Events[K]>,
        options?: EventOptions | boolean
    ): () => void {
        const key = event as unknown as PropertyKey;
        const isBooleanOption = typeof options === 'boolean';
        const opts = (!isBooleanOption && typeof options === 'object' && options !== null)
            ? options as EventOptions
            : undefined;
        const once = isBooleanOption ? options : Boolean(opts?.once);
        const signal = opts?.signal;

        const unsubscribe = () => this.off(event, listener);

        if (signal?.aborted) {
            return () => {};
        }

        const entry: ListenerEntry<Events[K]> = { handler: listener, once };

        if (signal) {
            const abortListener = () => unsubscribe();
            signal.addEventListener('abort', abortListener, { once: true });
            entry.cleanup = () => signal.removeEventListener('abort', abortListener);
        }

        const bucket = this.listeners.get(key);
        if (bucket) {
            if (!bucket.some(e => e.handler === listener)) {
                bucket.push(entry);
            }
        } else {
            this.listeners.set(key, [entry]);
        }

        return unsubscribe;
    }

    off<K extends keyof Events>(event: K, listener: Handler<Events[K]>): void {
        const key = event as unknown as PropertyKey;
        const bucket = this.listeners.get(key);
        if (!bucket) return;

        for (let i = 0; i < bucket.length; i++) {
            const entry = bucket[i];
            if (entry.handler === listener) {
                entry.cleanup?.();
                entry.handler = false;
                break;
            }
        }
        // Outside a dispatch, drop the dead entry immediately. Without this an
        // on()/off() cycle with no intervening emit leaks one entry per cycle:
        // on() only dedups against *live* handlers, so re-registering the same
        // listener appends a fresh entry and leaves the tombstone behind.
        if (this.dispatchDepth === 0) this.compact(key);
    }

    /** Remove tombstoned entries from a bucket, dropping the bucket entirely
     *  once it is empty. Always re-reads the live array from the map — a
     *  caller's captured reference can be stale (see emit). */
    private compact(key: PropertyKey): void {
        const bucket = this.listeners.get(key);
        if (!bucket) return;
        for (let i = bucket.length - 1; i >= 0; i--) {
            if (bucket[i].handler === false) bucket.splice(i, 1);
        }
        if (bucket.length === 0) this.listeners.delete(key);
    }

    emit<K extends keyof Events>(event: K, ...args: Params<Events[K]>): number {
        const key = event as unknown as PropertyKey;
        const bucket = this.listeners.get(key);
        if (!bucket || bucket.length === 0) {
            return 0;
        }

        let invoked = 0;

        // Iterate a snapshot of the bucket, not the bucket itself. A handler is
        // free to re-enter emit() for this same event, or to call on()/off()/
        // clear() — all of which can mutate the live array. Iterating it
        // directly means a splice shifts indices under the loop and silently
        // skips handlers. The snapshot shares its *entries* with the live
        // array, so a listener killed mid-dispatch (once-fire, off(), clear())
        // is still observed as dead here and does not run.
        const snapshot = bucket.slice();
        this.dispatchDepth++;
        try {
            for (const entry of snapshot) {
                if (entry.handler === false) continue;
                const handler = entry.handler as Handler<Events[K]>;
                if (entry.once) {
                    entry.cleanup?.();
                    entry.handler = false;
                }
                try {
                    handler(...args);
                } catch (err) {
                    console.error(`[EventBus] handler for "${String(event)}" threw:`, err);
                }
                invoked++;
            }
        } finally {
            this.dispatchDepth--;
        }

        // Compact only once the outermost dispatch unwinds, and re-read the
        // bucket from the map rather than reusing the reference captured above.
        // A nested emit can empty the bucket and delete the key, after which an
        // on() call installs a *different* array under it — compacting the
        // stale reference would then delete a bucket full of live listeners.
        if (this.dispatchDepth === 0) this.compact(key);

        return invoked;
    }

    /** Drop listeners for one event, or all of them. Entries are tombstoned as
     *  well as unmapped so that a clear() performed *from inside* a handler
     *  (e.g. an error handler that tears the session down) stops the in-flight
     *  dispatch instead of letting the remaining listeners run against
     *  already-destroyed state. */
    clear(event?: keyof Events): void {
        if (event === undefined) {
            for (const [, bucket] of this.listeners) {
                for (const e of bucket) { e.cleanup?.(); e.handler = false; }
            }
            this.listeners.clear();
            return;
        }
        const key = event as unknown as PropertyKey;
        const bucket = this.listeners.get(key);
        if (!bucket) return;
        for (const e of bucket) { e.cleanup?.(); e.handler = false; }
        this.listeners.delete(key);
    }

    listenerCount(event: keyof Events): number {
        const bucket = this.listeners.get(event as unknown as PropertyKey);
        if (!bucket) return 0;
        return bucket.filter(e => e.handler !== false).length;
    }
}
