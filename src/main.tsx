import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import './ui/components/components.css';
import App from './App';
import { ConfirmProvider } from './ui/components';
import { registerVfsServiceWorker } from './scripting/vfs/vfsBridge';
import { installPinchZoomGuard } from './ui/preventPinchZoom';

// Kick off SW registration eagerly; it doesn't block render. The first request
// for a /__vfs/* asset will await the SW being active via vfs:read message
// handling on the page side.
void registerVfsServiceWorker();

// Block accidental page pinch-zoom on the app chrome (the map keeps its own).
installPinchZoomGuard();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ConfirmProvider>
            <App />
        </ConfirmProvider>
    </StrictMode>,
);
