import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import './ui/components/components.css';
import { MudixApp } from './MudixApp';
import { registerVfsServiceWorker } from './scripting/vfs/vfsBridge';
import { installPinchZoomGuard } from './ui/preventPinchZoom';

// Kick off SW registration eagerly; it doesn't block render. The first request
// for a /__vfs/* asset will await the SW being active via vfs:read message
// handling on the page side.
void registerVfsServiceWorker();

// Block accidental page pinch-zoom on the app chrome (the map keeps its own).
installPinchZoomGuard();

// The stock app is just MudixApp with no brand — branded builds import
// MudixApp from the library entry and pass their own BrandConfig.
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <MudixApp />
    </StrictMode>,
);
