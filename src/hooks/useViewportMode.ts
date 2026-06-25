import { useSyncExternalStore } from 'react';

/**
 * Responsive breakpoints (px). Kept in sync with the `--bp-*` tokens and the
 * `@media` blocks in App.css — change them in both places.
 *   mobile  : width ≤ 600            (phones — single-column layout branch)
 *   tablet  : 601 ≤ width ≤ 900      (fluid modals, desktop-ish layout)
 *   desktop : width > 900            (full dock/float UX)
 */
export const MOBILE_MAX_WIDTH = 600;
export const TABLET_MAX_WIDTH = 900;

export type ViewportMode = 'mobile' | 'tablet' | 'desktop';

function readMode(): ViewportMode {
    if (typeof window === 'undefined') return 'desktop';
    const w = window.innerWidth;
    if (w <= MOBILE_MAX_WIDTH) return 'mobile';
    if (w <= TABLET_MAX_WIDTH) return 'tablet';
    return 'desktop';
}

/**
 * matchMedia is the cheap, debounced-by-the-browser way to subscribe: we only
 * re-render when crossing a breakpoint, not on every resize pixel. We listen on
 * both boundaries and recompute the mode from innerWidth on either change.
 */
function subscribe(onChange: () => void): () => void {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const queries = [
        window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`),
        window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`),
    ];
    for (const q of queries) q.addEventListener('change', onChange);
    return () => {
        for (const q of queries) q.removeEventListener('change', onChange);
    };
}

/** Current responsive mode, re-rendering the caller when it changes. */
export function useViewportMode(): ViewportMode {
    return useSyncExternalStore(subscribe, readMode, () => 'desktop');
}

/** Convenience: true on phone-sized viewports (the single-column layout branch). */
export function useIsMobile(): boolean {
    return useViewportMode() === 'mobile';
}
