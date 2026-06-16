import { useEffect, useState } from 'react';

// Detects whether the app is already running as an installed PWA.
function getStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari
  );
}

function getIsIOS() {
  const ua = window.navigator.userAgent || '';
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac but is touch-capable
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

/**
 * Surfaces the platform's install affordance.
 *
 * - Android/Chromium: `canPrompt` is true once the browser fires
 *   `beforeinstallprompt` (captured early in main.jsx and stashed on window);
 *   call `promptInstall()` for a one-tap native install.
 * - iOS Safari: no programmatic install — `isIOS` is true and the UI should
 *   show Share → Add to Home Screen instructions instead.
 * - Already installed: `isStandalone` is true; callers hide all install UI.
 */
export function useInstall() {
  const [canPrompt, setCanPrompt] = useState(!!window.__fsaInstallPrompt);
  const [isStandalone, setIsStandalone] = useState(getStandalone());

  useEffect(() => {
    const onAvailable = () => setCanPrompt(true);
    const onInstalled = () => { setCanPrompt(false); setIsStandalone(true); };
    window.addEventListener('fsa-installable', onAvailable);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('fsa-installable', onAvailable);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function promptInstall() {
    const evt = window.__fsaInstallPrompt;
    if (!evt) return false;
    evt.prompt();
    const choice = await evt.userChoice;
    window.__fsaInstallPrompt = null;
    setCanPrompt(false);
    return choice && choice.outcome === 'accepted';
  }

  return { canPrompt, isIOS: getIsIOS(), isStandalone, promptInstall };
}
