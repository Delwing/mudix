import { useEffect, useRef } from 'react';
import type { MudSession } from '../../mud/MudSession';
import { AnsiAwareBuffer } from '../../mud/text/FormatState';

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
const MAX_LINES = 60;

export function ScreenReaderLog({ session }: { session: MudSession }) {
    const regionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const region = regionRef.current;
        if (!region) return;

        const unsubscribe = session.events.on('message', (text, type) => {
            if (text === undefined || text === null) return;
            if (type && SKIP_TYPES.has(type)) return;

            // Strip ANSI: raw strings route through a buffer (same as the logger);
            // an AnsiAwareBuffer already exposes its plain text.
            const plain = typeof text === 'string' ? new AnsiAwareBuffer(text).text : text.text;
            // Empty/whitespace-only lines produce no speech — skip the node churn.
            if (!plain.trim()) return;

            const line = document.createElement('div');
            line.textContent = plain;
            region.appendChild(line);

            while (region.childElementCount > MAX_LINES && region.firstChild) {
                region.removeChild(region.firstChild);
            }
        });

        return unsubscribe;
    }, [session]);

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
