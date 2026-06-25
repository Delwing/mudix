/**
 * Raises `mapOpenEvent` at most once per ScriptingEngine instance.
 *
 * Both the script load (when the map is already visible) and the
 * `WindowManager.onMapOpen` callback (when the user opens the map later)
 * route through `notify()`; the latch dedupes across both paths so repeat
 * opens — re-show after hide, autoOpen idempotency, bring-to-front — stay
 * silent. A profile/connection switch tears down the engine, so the next
 * lifecycle gets a fresh latch and a fresh firing.
 */
export class MapOpenNotifier {
    private fired = false;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly raise: () => void) {}

    notify(): void {
        if (this.fired) return;
        this.fired = true;
        // Defer the raise off the (boot) critical path. The map widget opening
        // during profile load otherwise fires mapOpenEvent synchronously, and a
        // user handler that iterates a large map (the Arkadia case in issue #2)
        // blocks startup for hundreds of ms. A macrotask hop lets boot/render
        // settle first; the once-latch above still dedupes repeat opens, and
        // the emit is a no-op if the runtime was torn down before it fires.
        this.timer = setTimeout(() => {
            this.timer = null;
            this.raise();
        }, 0);
    }

    /** Cancel a still-pending deferred raise (engine teardown). */
    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
