/**
 * Suppress the browser's page pinch-zoom across the app. On a fixed app UI the
 * page-level zoom is just an annoyance (accidental zooms while scrolling/tapping)
 * — the layout is already responsive and the command line has its own font
 * controls. The viewport meta (`maximum-scale=1, user-scalable=no`) covers
 * Chrome/Android, but iOS Safari ignores that flag for accessibility, so we also
 * cancel its non-standard `gesture*` events and any 2-finger `touchmove`.
 *
 * The map panel implements its OWN pinch-to-zoom, so gestures that originate
 * inside `.map-panel` are left untouched.
 */
const MAP_SELECTOR = '.map-panel';

function inMap(target: EventTarget | null): boolean {
    const el = target as Element | null;
    return !!el && typeof el.closest === 'function' && el.closest(MAP_SELECTOR) !== null;
}

export function installPinchZoomGuard(): void {
    // iOS Safari: pinch is reported via non-standard gesture* events; cancelling
    // the start aborts the zoom.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        document.addEventListener(type, (e) => {
            if (!inMap(e.target)) e.preventDefault();
        }, { passive: false });
    }

    // Everywhere else: a 2-finger touchmove is a pinch. Single-finger scrolling
    // (touches.length === 1) is never touched, so normal scroll is unaffected.
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1 && !inMap(e.target)) e.preventDefault();
    }, { passive: false });
}
