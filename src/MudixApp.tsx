import { useState } from 'react';
import App from './App';
import { ConfirmProvider } from './ui/components';
import { setBrand, type BrandConfig } from './branding';
import { registerVfsServiceWorker } from './scripting/vfs/vfsBridge';
import { installPinchZoomGuard } from './ui/preventPinchZoom';

// Page-level side effects, run once regardless of how many times MudixApp
// mounts (StrictMode double-invokes initializers). Living here — not in
// main.tsx — so library consumers get them without extra wiring.
let bootstrapped = false;
function bootstrapPage(): void {
    if (bootstrapped) return;
    bootstrapped = true;
    // Kick off SW registration eagerly; it doesn't block render. The first
    // request for a /__vfs/* asset awaits the SW being active via vfs:read
    // message handling on the page side.
    void registerVfsServiceWorker();
    // Block accidental page pinch-zoom on the app chrome (the map keeps its own).
    installPinchZoomGuard();
}

/**
 * Public root component — the entry point for both the stock app (`main.tsx`)
 * and branded builds consuming mudix as a library. The brand is installed into
 * the module-level singleton synchronously on first render, before any child
 * reads `getBrand()`. The brand is fixed for the lifetime of the app; changing
 * the prop later has no effect.
 */
export function MudixApp({ brand }: { brand?: Partial<BrandConfig> }) {
    // useState initializer = runs once, synchronously, before children render.
    useState(() => {
        setBrand(brand);
        bootstrapPage();
        return null;
    });
    return (
        <ConfirmProvider>
            <App />
        </ConfirmProvider>
    );
}
