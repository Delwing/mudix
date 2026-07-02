import { scanEscape } from "../text/ansiEscapes";

export const DEFAULT_PROMPT_TIMEOUT_MS = 300;

/**
 * Keep prompt-flush timeouts in a sane range. 0 disables the safety net (only
 * a real GA/EOR or the next chunk's newline will flush a partial tail) — handy
 * for tests but risky for GA-less MUDs. The upper bound stops a typo from
 * stalling output for minutes.
 */
export function clampPromptTimeout(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) return DEFAULT_PROMPT_TIMEOUT_MS;
    return Math.min(ms, 5000);
}

export interface LineAssemblerCallbacks {
    /** Deliver assembled whole lines (or a flushed prompt tail) downstream —
     *  the trigger pipeline and rendering treat each chunk as complete lines. */
    onChunk(text: string, ts: number): void;
    /** Fired after a prompt marker (IAC GA/EOR) flushed the held tail — the
     *  owner emits its `prompt` event here. */
    onPrompt(): void;
    /** Fired after an idle-timer flush so the owner can render any messages
     *  the flushed chunk produced (MudClient.flushMessageBuffer). */
    onIdleFlush(): void;
}

export interface LineAssemblerOptions {
    promptTimeoutMs?: number;
    /** Mudlet `mUSE_IRE_DRIVER_BUGFIX` — strip a spurious leading newline from
     *  GA-driven prompt blocks. Off by default; toggled live via
     *  setFixUnnecessaryLinebreaks (setConfig). */
    fixUnnecessaryLinebreaks?: boolean;
}

/**
 * Assembles the decoded MUD text stream into whole lines. WebSocket frames can
 * split a long line at an arbitrary byte (mid-word, mid-ANSI-escape), so the
 * trailing partial line of each frame is held back until the next frame
 * supplies the rest, a prompt marker (IAC GA/EOR) flushes it, or the idle
 * timer fires. Our render path finalizes every emitted chunk and has no
 * downstream open-line carry (unlike Mudlet's TBuffer), so the "line ends only
 * at \n or GA" invariant is enforced here. The live-partial parity work is
 * deferred — see docs/line-assembly-tbuffer-port.md.
 */
export class LineAssembler {
    /** Trailing text (after the last `\n`) held back from rendering until either
     *  the next frame supplies the rest of the line, a prompt marker arrives, or
     *  the idle-flush timer fires. Prevents spurious line breaks when a long MUD
     *  line is split across multiple WebSocket frames. */
    private pendingLineTail = "";
    private pendingTailTimer: number | null = null;
    private promptTimeoutMs: number;
    /** Set true once the server has sent IAC GA / IAC EOR at least once.
     *  Mirrors Mudlet's `mGA_Driver` latch (`cTelnet::gotRest`). From then on
     *  the held partial tail is flushed by the prompt marker rather than the
     *  idle timer. Note: unlike Mudlet's cTelnet — which posts GA-mode chunks
     *  verbatim and reassembles split lines in TBuffer — we keep buffering
     *  partial lines here, because our render path finalizes every emitted
     *  chunk and has no downstream open-line carry. */
    private _gaDriver = false;
    /** True at the start of a GA-driven data block — i.e. before any content of
     *  the current post-GA transmission has been seen. Drives the
     *  `fixUnnecessaryLinebreaks` leading-newline strip, which fires at most once
     *  per block. Set true on connect and after each prompt flush, cleared once
     *  the block's leading-newline question has been settled. */
    private atPromptBlockStart = true;
    private fixUnnecessaryLinebreaks: boolean;

    constructor(
        private readonly callbacks: LineAssemblerCallbacks,
        options: LineAssemblerOptions = {},
    ) {
        this.promptTimeoutMs = clampPromptTimeout(options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS);
        this.fixUnnecessaryLinebreaks = options.fixUnnecessaryLinebreaks ?? false;
    }

    /** True once the session has latched into GA-driven prompt mode. */
    get gaDriver(): boolean {
        return this._gaDriver;
    }

    setPromptTimeoutMs(ms: number): void {
        this.promptTimeoutMs = clampPromptTimeout(ms);
    }

    getPromptTimeoutMs(): number {
        return this.promptTimeoutMs;
    }

    /** Mudlet `setConfig("fixUnnecessaryLinebreaks", …)`. Takes effect on the
     *  next GA-driven block; never retroactive. */
    setFixUnnecessaryLinebreaks(enabled: boolean): void {
        this.fixUnnecessaryLinebreaks = enabled;
    }

    /** Drop all held state (call on connect and after close). */
    reset(): void {
        this.pendingLineTail = "";
        this._gaDriver = false;
        this.atPromptBlockStart = true;
        this.clearTailTimer();
    }

    /** Feed one frame's decoded text plus whether the frame carried a prompt
     *  marker (IAC GA/EOR). Emits only whole lines (text up to and including
     *  the last `\n`) and holds the trailing partial in `pendingLineTail`
     *  until the rest of the line arrives, a prompt marker flushes it, or the
     *  idle timer fires. */
    feed(decoded: string, hasPrompt: boolean, ts: number): void {
        if (decoded.length > 0) {
            this.clearTailTimer();
            let combined = this.pendingLineTail + decoded;
            // Mudlet's "Fix unnecessary linebreaks on GA servers": at the start
            // of a GA-driven block, drop a single spurious leading newline (the
            // IRE-driver bug). Done at block-start rather than at the GA — like
            // Mudlet's cTelnet::gotPrompt — because our render path emits whole
            // lines eagerly and can't retract them once the GA arrives. The block
            // after a GA begins at the very next byte, so its leading newline is
            // the same one Mudlet would strip from mMudData at the next GA.
            // (Deviation: Mudlet also strips the first block at the first GA via
            // buffering; we can't see that block is GA-driven until the GA lands,
            // so the very first transmission keeps its leading newline.)
            if (this.fixUnnecessaryLinebreaks && this._gaDriver && this.atPromptBlockStart) {
                const { result, decided } = stripLeadingPromptNewline(combined);
                if (decided) {
                    combined = result;
                    this.atPromptBlockStart = false;
                }
            }
            const lastNl = combined.lastIndexOf('\n');
            if (lastNl === -1) {
                this.pendingLineTail = combined;
            } else {
                const ready = combined.substring(0, lastNl + 1);
                this.pendingLineTail = combined.substring(lastNl + 1);
                this.callbacks.onChunk(ready, ts);
            }
        }

        if (hasPrompt) {
            this.flush(ts);
            this._gaDriver = true;
            // The next data block (the next transmission) starts fresh, so its
            // leading newline is again a candidate for the IRE-bug strip above.
            this.atPromptBlockStart = true;
            this.callbacks.onPrompt();
        } else if (this.pendingLineTail.length > 0) {
            this.scheduleTailFlush();
        }
    }

    /** Flush a held-back partial line (text after the final `\n` of a frame).
     *  Triggered by prompt markers (IAC GA/EOR), the idle-flush timer, or
     *  socket close. Pushes the tail through the normal chunk path so triggers
     *  and rendering treat it as a complete line. */
    flush(ts: number, final = false): void {
        this.clearTailTimer();
        if (this.pendingLineTail.length === 0) return;
        let tail = this.pendingLineTail;
        // A prompt tail can end mid-ANSI-escape when the server splits e.g.
        // `…known? \x1b[K` across frames so the bare `\x1b` lands at the end of
        // one chunk. Flushing it now would drop the lone ESC (parseAnsiSegments
        // discards a truncated trailing escape) and then render the `[K` that
        // follows as literal text. So hold the incomplete escape back — like a
        // partial UTF-8 sequence — and let the next frame complete it. On a
        // genuine end-of-stream (`final`, i.e. socket close) there is no "next
        // frame", so flush everything verbatim.
        let held = "";
        if (!final) {
            const cut = incompleteEscapeTailStart(tail);
            if (cut !== -1) {
                held = tail.slice(cut);
                tail = tail.slice(0, cut);
            }
        }
        this.pendingLineTail = held;
        // Nothing renderable before the held escape — keep holding it (don't
        // reschedule: a never-completing escape would spin the timer forever;
        // the next inbound frame recombines it).
        if (tail.length === 0) return;
        this.callbacks.onChunk(tail, ts);
    }

    private scheduleTailFlush(): void {
        if (this.pendingTailTimer !== null) return;
        this.pendingTailTimer = window.setTimeout(() => {
            this.pendingTailTimer = null;
            if (this.pendingLineTail.length === 0) return;
            this.flush(Date.now());
            this.callbacks.onIdleFlush();
        }, this.promptTimeoutMs);
    }

    private clearTailTimer(): void {
        if (this.pendingTailTimer !== null) {
            clearTimeout(this.pendingTailTimer);
            this.pendingTailTimer = null;
        }
    }
}

/**
 * Mudlet's "Fix unnecessary linebreaks on GA servers" core, ported from
 * `cTelnet::gotPrompt` (gated there on `mUSE_IRE_DRIVER_BUGFIX && mGA_Driver`).
 * IRE-style servers prepend a spurious <LF> to each GA-terminated transmission,
 * which renders as a blank line before every prompt block. This removes a single
 * leading newline from the front of a GA-driven block — first skipping any
 * leading ANSI SGR escape sequence, exactly as Mudlet does (`if (mMudData[j] ==
 * 0x1B) … scan to 'm'`).
 *
 * Returns the (possibly trimmed) string and `decided`:
 *  - `decided: true`  — the leading-newline question is settled for this block
 *    (a newline was removed, or the first real byte wasn't a newline).
 *  - `decided: false` — so far the block is *only* ANSI escapes, or ends inside
 *    an incomplete escape (no terminating 'm' yet). The caller should keep the
 *    block-start flag set and retry once more bytes arrive. (Mudlet never hits
 *    this case — it has the whole block in hand at GA time — but we decide
 *    incrementally as frames stream in.)
 */
function stripLeadingPromptNewline(s: string): { result: string; decided: boolean } {
    let i = 0;
    while (i < s.length) {
        if (s.charCodeAt(i) === 0x1b) {
            // Skip an ANSI escape up to and including its 'm' (SGR) terminator.
            let j = i + 1;
            while (j < s.length && s[j] !== 'm') j++;
            if (j >= s.length) return { result: s, decided: false }; // incomplete — wait
            i = j + 1;
            continue;
        }
        // First non-escape byte reached: strip it iff it's the spurious newline.
        if (s[i] === '\n') return { result: s.slice(0, i) + s.slice(i + 1), decided: true };
        return { result: s, decided: true };
    }
    // Ran off the end with only complete ANSI escapes — no content byte yet.
    return { result: s, decided: false };
}

/**
 * If `s` ends with an ANSI/ECMA-48 escape sequence that runs off the end of the
 * string (a bare trailing `\x1b`, or `\x1b[` / `\x1b]…` with no final byte yet),
 * return the index where that incomplete escape begins; otherwise -1. Used to
 * keep a partial escape attached to the start of the next frame instead of
 * flushing it split — which would drop the lone ESC and leak the completion
 * (e.g. `[K`) as literal text. A complete trailing escape returns -1 (nothing to
 * hold). Only the *last* escape can be incomplete, so checking it suffices.
 */
function incompleteEscapeTailStart(s: string): number {
    const esc = s.lastIndexOf("\x1b");
    if (esc === -1) return -1;
    return scanEscape(s, esc).kind === "incomplete" ? esc : -1;
}
