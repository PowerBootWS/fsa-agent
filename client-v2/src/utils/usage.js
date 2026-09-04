/**
 * First-party usage beacons (backlog #113).
 *
 * learn.fullsteamahead.ca's CSP has blocked GA4 since before the tag was even
 * added, and the owner's decision was not to loosen CSP on the authenticated
 * app but to measure from our own database. This module is the client half.
 *
 * Two rules govern what belongs here:
 *   1. If a row already exists for it, it is not an event. Questions answered,
 *      lessons completed, exams and saved jobs all have their own tables and
 *      are read from there at report time.
 *   2. Telemetry never breaks the app. Every failure path here is swallowed.
 */
import taxonomy from './usageTaxonomy.json';
import { postJson } from './api';

const ENDPOINT = '/api/events';
const FLUSH_MS = 10000;
const MAX_BATCH = 50;

let queue = [];
let timer = null;

function isAuthenticated() {
  try {
    return Boolean(localStorage.getItem('fsa_user'));
  } catch {
    return false; // Safari private mode and friends
  }
}

function sessionId() {
  try {
    let id = sessionStorage.getItem('fsa_usage_session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('fsa_usage_session', id);
    }
    return id;
  } catch {
    return null;
  }
}

export function track(type, { screen = null, action = null, props = {} } = {}) {
  if (!isAuthenticated()) return;
  if (type === 'screen_view' && !taxonomy.screens.includes(screen)) return;
  if (type === 'feature_use' && !taxonomy.actions.includes(action)) return;
  if (type !== 'screen_view' && type !== 'feature_use') return;

  queue.push({
    type,
    screen,
    action,
    props,
    session_id: sessionId(),
    at: new Date().toISOString(),
  });
}

export async function flush({ beacon = false } = {}) {
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  const payload = JSON.stringify({ events: batch });

  // Transport split, deliberate. The timer flush goes through api.js per
  // backlog #68 ("one way to call the API"). The unload flush cannot: api.js
  // has no beacon path, and a normal fetch during pagehide is not guaranteed
  // to be sent. This is the one sanctioned exception to #68.
  if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } catch {
      /* telemetry never breaks the app */
    }
    return;
  }

  try {
    if (beacon) {
      await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
    } else {
      await postJson(ENDPOINT, { events: batch });
    }
  } catch {
    /* dropped on the floor by design — never surface telemetry failure */
  }
}

export function startUsageFlushing() {
  timer = setInterval(() => {
    flush();
  }, FLUSH_MS);

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush({ beacon: true });
  };
  const onPageHide = () => flush({ beacon: true });

  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
  };
}

export function __resetForTests() {
  queue = [];
  if (timer) clearInterval(timer);
  timer = null;
}

export default { track, flush, startUsageFlushing };
