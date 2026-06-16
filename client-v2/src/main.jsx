import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Capture the install prompt as early as possible (Chromium fires this once,
// often before React mounts). Stash it so the user-menu "Install app" action
// and the lobby banner can trigger it on demand. See hooks/useInstall.js.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__fsaInstallPrompt = e;
  window.dispatchEvent(new Event('fsa-installable'));
});

// Register the service worker (root scope) so the app is installable and the
// shell loads fast. Served at /sw.js by express.static on learn.*.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* SW registration is best-effort — never block the app */
    });
  });
}
