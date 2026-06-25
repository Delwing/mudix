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

// Cap the live region size so it never grows unbounded. Screen readers only
// announce additions, so old lines just need to be evictable.
export const MAX_LINES = 60;

/**
 * Append one MUD `message` line's plain text to the live `region`, applying the
 * same filtering the session logger uses and capping the region size. Exported
 * for testing. Returns true when a line node was appended.
 *
 * Drops: interim `script-partial` cecho output (superseded by the finalized
 * line), missing text, and blank/whitespace-only lines (no speech, only churn).
 * Raw strings carry ANSI, so they route through an {@link AnsiAwareBuffer} for
 * the plain text; an `AnsiAwareBuffer` payload already exposes `.text`.
 */
export function feedScreenReaderLine(
    region: HTMLElement,
    text?: string | AnsiAwareBuffer,
    type?: string,
): boolean {
    if (text === undefined || text === null) return false;
    if (type && SKIP_TYPES.has(type)) return false;

    const plain = typeof text === 'string' ? new AnsiAwareBuffer(text).text : text.text;
    if (!plain.trim()) return false;

    const line = document.createElement('div');
    line.textContent = plain;
    region.appendChild(line);

    while (region.childElementCount > MAX_LINES && region.firstChild) {
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

        const unsubscribe = session.events.on('message', (text, type) => {
            feedScreenReaderLine(region, text, type);
        });

        return unsubscribe;
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
