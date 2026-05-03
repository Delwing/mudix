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
    }

    emit<K extends keyof Events>(event: K, ...args: Params<Events[K]>): number {
        const key = event as unknown as PropertyKey;
        const bucket = this.listeners.get(key);
        if (!bucket || bucket.length === 0) {
            return 0;
        }

        let invoked = 0;

        for (const entry of bucket) {
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

        for (let i = bucket.length - 1; i >= 0; i--) {
            if (bucket[i].handler === false) {
                bucket.splice(i, 1);
            }
        }

        if (bucket.length === 0) {
            this.listeners.delete(key);
        }

        return invoked;
    }

    clear(event?: keyof Events): void {
        if (event === undefined) {
            for (const [, bucket] of this.listeners) {
                for (const e of bucket) e.cleanup?.();
            }
            this.listeners.clear();
            return;
        }
        const key = event as unknown as PropertyKey;
        const bucket = this.listeners.get(key);
        if (!bucket) return;
        for (const e of bucket) e.cleanup?.();
        this.listeners.delete(key);
    }

    listenerCount(event: keyof Events): number {
        const bucket = this.listeners.get(event as unknown as PropertyKey);
        if (!bucket) return 0;
        return bucket.filter(e => e.handler !== false).length;
    }
}
