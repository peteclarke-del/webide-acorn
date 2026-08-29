import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './theme.css';
import './styles.css';
import { installRandomUuidCompatibility } from './platform/randomUuid';

installRandomUuidCompatibility();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/rom-service-worker.js', { scope: '/' }).catch((error) => {
    console.warn('User ROM service worker could not be registered', error);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
