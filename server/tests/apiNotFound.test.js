/**
 * Regression tests for the app-level soft-404 (audit 2026-08-12).
 *
 * `app.get('*')` in src/index.js answered EVERY unmatched GET with the SPA's
 * index.html and a 200, including unknown /api paths, missing /media files and
 * missing /v2 build assets. Confirmed live on the public URL before the fix:
 *
 *   GET https://learn.fullsteamahead.ca/api/definitely-not-a-route
 *     -> HTTP 200 ct=text/html; charset=UTF-8 len=1712
 *   GET https://learn.fullsteamahead.ca/v2/assets/does-not-exist-abc123.js
 *     -> HTTP 200 ct=text/html; charset=UTF-8 len=1712
 *   GET https://learn.fullsteamahead.ca/media/does-not-exist-abc123.mp3
 *     -> HTTP 200 ct=text/html; charset=UTF-8 len=1712
 *
 * Real SPA routes must keep falling through to index.html — only paths that
 * name a file, and anything under /api or /media, are 404 candidates.
 */
process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';

const path = require('path');
// The container layout puts client-v2/build next to src/; in the repo it is at
// the repo root. Point the app at the real build so the SPA fallback is exercised.
process.env.CLIENT_V2_BUILD_DIR =
  process.env.CLIENT_V2_BUILD_DIR || path.join(__dirname, '../../client-v2/build');
process.env.CLIENT_V1_BUILD_DIR =
  process.env.CLIENT_V1_BUILD_DIR || path.join(__dirname, '../../client/build');

const request = require('supertest');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';
const LEGACY = 'fsachat.fullsteamahead.ca';

describe('unknown /api paths return a real 404', () => {
  it('404s an unknown GET under /api on the platform host', async () => {
    const res = await request(app).get('/api/definitely-not-a-route').set('Host', LEARN);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('404s an unknown GET under /api on the legacy host', async () => {
    const res = await request(app).get('/api/definitely-not-a-route').set('Host', LEGACY);
    expect(res.status).toBe(404);
  });

  it('404s an unknown POST under /api', async () => {
    const res = await request(app).post('/api/definitely-not-a-route').set('Host', LEARN).send({});
    expect(res.status).toBe(404);
  });

  it('never answers an unknown /api path with the SPA shell', async () => {
    const res = await request(app).get('/api/nope/nope').set('Host', LEARN);
    expect(res.text || '').not.toMatch(/<!doctype html/i);
  });

  it('leaves a real API route alone', async () => {
    // /api/lesson is auth-gated on learn.* — 401 proves it was routed, not 404'd.
    const res = await request(app).get('/api/lesson/2A1-1-1').set('Host', LEARN);
    expect(res.status).toBe(401);
  });
});

describe('missing static resources return a real 404', () => {
  it('404s a missing /media file', async () => {
    const res = await request(app).get('/media/does-not-exist-abc123.mp3').set('Host', LEARN);
    expect(res.status).toBe(404);
  });

  it('404s a missing /v2 build asset', async () => {
    const res = await request(app).get('/v2/assets/does-not-exist-abc123.js').set('Host', LEARN);
    expect(res.status).toBe(404);
  });

  it('404s a missing root-level asset on the platform host', async () => {
    const res = await request(app).get('/does-not-exist-abc123.png').set('Host', LEARN);
    expect(res.status).toBe(404);
  });
});

describe('SPA routing still works', () => {
  it('serves the client-v2 shell for a real platform route', async () => {
    const res = await request(app).get('/lobby').set('Host', LEARN);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<!doctype html/i);
  });

  it('serves the client-v2 shell for a lesson route with a dashed code', async () => {
    const res = await request(app).get('/lesson/2A1-1-1').set('Host', LEARN);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<!doctype html/i);
  });

  it('serves the shell under /v2 for a real sub-route', async () => {
    const res = await request(app).get('/v2/lobby').set('Host', LEARN);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<!doctype html/i);
  });

  it('still serves a real built asset', async () => {
    const res = await request(app).get('/v2/favicon.svg').set('Host', LEARN);
    expect(res.status).toBe(200);
  });

  it('keeps /health working', async () => {
    const res = await request(app).get('/health').set('Host', LEARN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
