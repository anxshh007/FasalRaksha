import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyToDocument, loadPreferences } from './state/preferences';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('The #root element is missing from index.html.');

// Language and theme come from the device store before the first paint: no theme flash, and
// `lang` is right for the very first text drawn. An IndexedDB read, never a network request.
const preferences = await loadPreferences();
applyToDocument(preferences);

createRoot(root).render(
  <StrictMode>
    <App preferences={preferences} />
  </StrictMode>,
);

// The service worker exists only in a production build: in development it would cache the
// dev server's modules and hide every edit.
// Registered after load so it never competes with first paint. The module awaits the device
// store above, so `load` may already have fired by the time this line runs.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => void navigator.serviceWorker.register('/sw.js', { scope: '/' });
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
