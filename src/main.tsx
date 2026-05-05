import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import './ui/components/components.css';
import App from './App';
import { ConfirmProvider } from './ui/components';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ConfirmProvider>
            <App />
        </ConfirmProvider>
    </StrictMode>,
);
