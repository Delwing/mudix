import { useEffect, useRef } from 'react';
import type { MudSession } from '../../mud/MudSession';
import { AnsiAwareBuffer } from '../../mud/text/FormatState';
import { useProfileField } from '../../storage';

/**
 * Off-screen ARIA live region that mirrors MUD output as plain text so the
 * user's own screen reader (NVDA / JAWS / VoiceOver / Orca) announces each new
 * line in their configured voice and braille output.
 *
 * This is deliberately separate from the visual output DOM: the real output is
 * a non-virtualized tree of styled/evicting spans, which a screen reader would
 * walk awkwardly. Here we keep a small, flat, plain-text mirror that the live
 * region announces on `additions` only. Lines are capped so the region never
 * grows unbounded; it is visually hidden but read by assistive tech.
 *
 * Not text-to-speech: `TtsManager` (the `ttsSpeak`/`ttsQueue` Lua API) is a
 * separate, script-driven feature. This region is the genuine screen-reader path.
 */

// Mirror the logger's skip set: 'script-partial' lines are interim cecho output
// that gets superseded by the finalized line, so announcing them double-speaks.
const SKIP_TYPES = new Set(['script-partial']);

// Cap the number of announcement batches the region holds so it never grows
// unbounded. Screen readers only announce additions, so superseded batches just
// need to be evictable.
export const MAX_LINES = 60;

/**
 * The plain text a `message` line should announce, or null when it must be
 * skipped: interim `script-partial` cecho output (superseded by the finalized
 * line), missing text, or blank/whitespace-only lines (no speech, only churn).
 * Raw strings carry ANSI, so they route through an {@link AnsiAwareBuffer} for
 * the plain text; an `AnsiAwareBuffer` payload already exposes `.text`. Pure.
 */
export function screenReaderPlainText(text?: string | AnsiAwareBuffer, type?: string): string | null {
    if (text === undefined || text === null) return null;
    if (type && SKIP_TYPES.has(type)) return null;
    const plain = typeof text === 'string' ? new AnsiAwareBuffer(text).text : text.text;
    return plain.trim() ? plain : null;
}

/**
 * Append a batch of lines to the live `region` as ONE node (a wrapper div with
 * a child per line) so the screen reader announces the whole burst once — the
 * way Mudlet coalesces a buffer update into a single announcement — instead of
 * once per line. Per-line child divs keep the line boundaries in the a11y tree.
 * Then cap the region to `maxLines` batches. Returns true when a batch was
 * appended. Exported for testing.
 */
export function flushScreenReaderLines(region: HTMLElement, lines: string[], maxLines = MAX_LINES): boolean {
    if (lines.length === 0) return false;
    const batch = document.createElement('div');
    for (const line of lines) {
        const el = document.createElement('div');
        el.textContent = line;
        batch.appendChild(el);
    }
    region.appendChild(batch);
    while (region.childElementCount > maxLines && region.firstChild) {
        region.removeChild(region.firstChild);
    }
    return true;
}

export function ScreenReaderLog({ session }: { session: MudSession }) {
    const regionRef = useRef<HTMLDivElement>(null);
    // Mudlet's mAnnounceIncomingText — when off, the live region is not fed (and
    // is cleared) so the user's screen reader stops narrating game output. The
    // key lives in the `setConfig` bag and defaults on (see CONFIG_PERSIST_ONLY).
    const config = useProfileField('config');
    const announce = (config?.announceIncomingText as boolean | undefined) ?? true;

    useEffect(() => {
        const region = regionRef.current;
        if (!region) return;
        if (!announce) {
            // Disabled mid-session: drop any pending lines so nothing lingers.
            region.replaceChildren();
            return;
        }

        // Coalesce all lines that arrive in one event-loop turn (e.g. a single
        // network packet emitting many `message` events) into one announcement,
        // flushed on a microtask. Matches Mudlet's per-buffer-update batching and
        // avoids per-line chatter on fast-scrolling MUDs.
        const pending: string[] = [];
        let scheduled = false;
        let disposed = false;
        const flush = () => {
            scheduled = false;
            if (disposed || pending.length === 0) return;
            flushScreenReaderLines(region, pending.splice(0, pending.length));
        };

        const unsubscribe = session.events.on('message', (text, type) => {
            const plain = screenReaderPlainText(text, type);
            if (plain === null) return;
            pending.push(plain);
            if (!scheduled) { scheduled = true; queueMicrotask(flush); }
        });

        return () => {
            disposed = true;
            unsubscribe();
            pending.length = 0;
        };
    }, [session, announce]);

    return (
        <div
            ref={regionRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-atomic="false"
            aria-label="MUD output"
            style={{
                position: 'absolute',
                width: 1,
                height: 1,
                margin: -1,
                padding: 0,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                clipPath: 'inset(50%)',
                border: 0,
                whiteSpace: 'nowrap',
            }}
        />
    );
}
