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

    constructor(private readonly raise: () => void) {}

    notify(): void {
        if (this.fired) return;
        this.fired = true;
        this.raise();
    }
}
