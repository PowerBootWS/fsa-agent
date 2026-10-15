// client-v2/src/utils/appVersion.js
// Which build this tab runs vs. which one the server now serves. See UpdateBanner.
const BUNDLE_RE = /\/v2\/assets\/index-[\w-]+\.js/;
export const CHECK_EVERY_MS = 5 * 60 * 1000;

export function runningBundle(doc = document) {
  const src = doc.querySelector('script[type="module"][src*="/v2/assets/index-"]')?.getAttribute('src');
  return src?.match(BUNDLE_RE)?.[0] || null;
}

export async function serverBundle() {
  const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  return (await res.text()).match(BUNDLE_RE)?.[0] || null;
}
