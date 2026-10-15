// client-v2/src/components/UpdateBanner.jsx
import { useEffect, useRef, useState } from 'react';
import './UpdateBanner.css';
import { CHECK_EVERY_MS, runningBundle, serverBundle } from '../utils/appVersion';

/**
 * UpdateBanner — "a new version is available" (2026-10-15).
 *
 * An open tab keeps running the build it loaded until a full reload; moving
 * around the app never refetches index.html. So after a deploy, students with
 * the app open stay on the old code (Russ hit this testing one-time check-ins).
 * This compares the bundle the tab is running with the one the server's
 * index.html now names, every few minutes and when the tab comes back into
 * view, and offers a refresh. Never reloads by itself: the student may be
 * mid-exam. Does nothing in dev, where there is no hashed bundle.
 */
const MIN_GAP_MS = 60 * 1000;

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    const mine = runningBundle();
    if (!mine) return undefined;
    let stopped = false;
    async function check() {
      if (stopped || Date.now() - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = Date.now();
      try {
        const live = await serverBundle();
        if (!stopped && live && live !== mine) setStale(true);
      } catch {
        // offline or a blip: try again next time
      }
    }
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!stale || dismissed) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of Full Steam Ahead is available.</span>
      <button className="update-banner-refresh" onClick={() => window.location.reload()}>Refresh</button>
      <button className="update-banner-close" aria-label="Dismiss" onClick={() => setDismissed(true)}>×</button>
    </div>
  );
}
