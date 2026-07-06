import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import './ui/components/components.css';
import { MudixApp } from './MudixApp';

// The stock app is just MudixApp with no brand — branded builds import
// MudixApp from the library entry and pass their own BrandConfig. Page
// bootstrap (VFS service worker, pinch-zoom guard) happens inside MudixApp.
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <MudixApp />
    </StrictMode>,
);
