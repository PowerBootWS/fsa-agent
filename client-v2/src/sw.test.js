import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load public/sw.js against a fake service-worker global and capture its fetch handler.
function loadSw() {
  const handlers = {};
  const fakeSelf = {
    location: { origin: 'https://learn.fullsteamahead.ca' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const fakeCaches = { match: async () => undefined, open: async () => ({ put: () => {}, add: async () => {} }), keys: async () => [] };
  const fakeFetch = async () => ({ clone: () => ({}) });
  const code = readFileSync(resolve(__dirname, '../public/sw.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', code)(fakeSelf, fakeCaches, fakeFetch);
  return (path) => {
    let responded = false;
    handlers.fetch({
      request: { method: 'GET', mode: 'no-cors', url: `https://learn.fullsteamahead.ca${path}` },
      respondWith: () => { responded = true; },
    });
    return responded;
  };
}

describe('service worker caching (minor M2)', () => {
  it('never handles mini-lesson media, so it is never cached', () => {
    const handled = loadSw();
    expect(handled('/explained-media/2b3-x/v1/slide-001.png?preview=tok')).toBe(false);
    expect(handled('/explained-media/2b3-x/v1/og.png')).toBe(false);
    expect(handled('/media/2B3-1-7/slide-001.png')).toBe(false);
  });

  it('still caches root icons', () => {
    expect(loadSw()('/pwa-192.png')).toBe(true);
  });
});
