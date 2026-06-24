/**
 * OSC 8 hyperlink `visibility` (Mudlet's THyperlinkVisibilityManager).
 *
 * Timer- and click-driven actions are wired directly onto the rendered link
 * element by {@link applyVisibility}:
 *   - **reveal**            — start hidden, reveal after `delayMs` (from render).
 *   - **conceal**           — start visible, conceal on click (now, or after
 *                             `delayMs`); with expire flags, arm instead.
 *   - **reveal-then-conceal** — reveal after `delayMs`, then conceal on click.
 *   - **deletesEntireLine** — conceal removes the whole output line.
 *
 * Expire-on-event links (conceal on the next user input / prompt / output after
 * being clicked) can't be driven from the element alone — they're tagged with
 * `data-osc-vis-*` attributes here, and {@link HyperlinkVisibilityController}
 * (owned by the session) conceals them when the matching session event fires.
 * The first occurrence of each trigger is skipped: it's the response to the very
 * command the click sent, not a fresh event.
 */

import type { VisibilitySettings } from "./hyperlinkConfig";

const OUTPUT_LINE_SELECTOR = ".output-msg";

/** trigger name → the `dataset` key holding its "skip the first occurrence" flag. */
const SKIP_KEY: Record<string, string> = {
    input: "oscVisSkipInput",
    prompt: "oscVisSkipPrompt",
    output: "oscVisSkipOutput",
};

function concealElement(el: HTMLElement, deleteLine: boolean): void {
    if (deleteLine) (el.closest(OUTPUT_LINE_SELECTOR) ?? el).remove();
    else el.style.visibility = "hidden";
}

/** Wire one link element's visibility behaviour. Call *after* the element's base
 *  style has been applied (it may set `visibility: hidden`, which a later
 *  `cssText` assignment would wipe). */
export function applyVisibility(el: HTMLElement, vis: VisibilitySettings): void {
    const delay = vis.delayMs && vis.delayMs > 0 ? vis.delayMs : 0;
    const deleteLine = vis.deletesEntireLine === true;
    const expires = (["input", "prompt", "output"] as const).filter((t) =>
        t === "input" ? vis.expireOnInput : t === "prompt" ? vis.expireOnPrompt : vis.expireOnOutput,
    );

    const conceal = (): void => concealElement(el, deleteLine);
    const reveal = (): void => { el.style.visibility = "visible"; };

    const armExpire = (): void => {
        el.dataset.oscVisExpire = expires.join(" ");
        if (deleteLine) el.dataset.oscVisDelete = "1";
        for (const t of expires) el.dataset[SKIP_KEY[t]] = "1";
    };

    switch (vis.action) {
        case "reveal":
            if (delay > 0) { el.style.visibility = "hidden"; setTimeout(reveal, delay); }
            break;
        case "reveal-then-conceal":
            if (delay > 0) { el.style.visibility = "hidden"; setTimeout(reveal, delay); }
            el.addEventListener("click", conceal);
            break;
        case "conceal":
            el.addEventListener("click", () => {
                if (expires.length > 0) armExpire();
                else if (delay > 0) setTimeout(conceal, delay);
                else conceal();
            });
            break;
    }
}

/**
 * Session-scoped driver for expire-on-event visibility links. The session calls
 * `onInput`/`onPrompt`/`onOutput` as those events occur; each conceals every
 * armed link whose trigger set includes that event (after skipping the first
 * occurrence). `getRoot` supplies the DOM subtree to scan (the live output).
 */
export class HyperlinkVisibilityController {
    constructor(private readonly getRoot: () => ParentNode | null) {}

    onInput(): void { this.fire("input"); }
    onPrompt(): void { this.fire("prompt"); }
    onOutput(): void { this.fire("output"); }

    private fire(trigger: "input" | "prompt" | "output"): void {
        const root = this.getRoot();
        if (!root) return;
        const skipKey = SKIP_KEY[trigger];
        // Snapshot — concealing with deleteLine removes nodes mid-iteration.
        for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-osc-vis-expire]"))) {
            const triggers = (el.dataset.oscVisExpire ?? "").split(" ");
            if (!triggers.includes(trigger)) continue;
            if (el.dataset[skipKey]) { delete el.dataset[skipKey]; continue; }
            concealElement(el, el.dataset.oscVisDelete === "1");
            el.removeAttribute("data-osc-vis-expire"); // fire once
        }
    }
}
