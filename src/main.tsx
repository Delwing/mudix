import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import './ui/components/components.css';
import { MudletWebApp } from './MudletWebApp';

// The stock app is just MudletWebApp with no brand — branded builds import
// MudletWebApp from the library entry and pass their own BrandConfig. Page
// bootstrap (VFS service worker, pinch-zoom guard) happens inside MudletWebApp.
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <MudletWebApp />
    </StrictMode>,
);
