import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './theme.css';
import './styles.css';
import { installRandomUuidCompatibility } from './platform/randomUuid';
import { applyAppearance, readAppearance } from './theme/appearance';

installRandomUuidCompatibility();

/*
 * The remembered appearance, before the first paint rather than after mounting.
 *
 * Applying it from an effect works and shows the default theme and type size
 * for a frame first, which is a flash of the wrong interface for exactly the
 * people who chose a different one because the default was hard to read.
 */
applyAppearance(
  document.documentElement,
  readAppearance(typeof localStorage === 'undefined' ? null : localStorage),
  (feature) => window.matchMedia(feature),
);

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
