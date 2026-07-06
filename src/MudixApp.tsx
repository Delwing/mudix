import { useState } from 'react';
import App from './App';
import { ConfirmProvider } from './ui/components';
import { setBrand, type BrandConfig } from './branding';

/**
 * Public root component — the entry point for both the stock app (`main.tsx`)
 * and branded builds consuming mudix as a library. The brand is installed into
 * the module-level singleton synchronously on first render, before any child
 * reads `getBrand()`. The brand is fixed for the lifetime of the app; changing
 * the prop later has no effect.
 */
export function MudixApp({ brand }: { brand?: Partial<BrandConfig> }) {
    // useState initializer = runs once, synchronously, before children render.
    useState(() => { setBrand(brand); return null; });
    return (
        <ConfirmProvider>
            <App />
        </ConfirmProvider>
    );
}
