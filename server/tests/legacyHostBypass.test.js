/**
 * Regression test proving the host-conditional auth bypass (audit 2026-08-16).
 *
 * `platformAuth` in src/index.js:88-91 only calls `requireAuth` when the Host
 * header contains learn.fullsteamahead.ca; every other Host (including no Host
 * at all) falls through to `next()` with no authentication whatsoever.
 * `requireActiveSubscription` (src/middleware/requireActiveSubscription.js:8)
 * has the identical `if (!req.isPlatformMode) return next();` escape hatch, so
 * even routes gated by BOTH middlewares are open on any non-learn.* Host.
 *
 * Verified live on the public internet, no credentials, on 2026-08-16:
 *   GET https://fsachat.fullsteamahead.ca/api/v2/lesson/2A1-1-1
 *   -> 200, 265,689 bytes of paid lesson content.
 * fsachat.fullsteamahead.ca is routed through the same Cloudflare Tunnel to
 * this same container, so any Host header that isn't learn.* reproduces it.
 *
 * This test's assertions describe the SECURE behaviour the fix (a later task)
 * must produce — every legacy-host request to a protected path must be refused
 * ([401, 403, 421], deliberately permissive because a later task changes the
 * exact status from 401 to 421) and must never leak lesson content. Right now
 * those assertions FAIL: the request reaches the route handler with no auth
 * at all. That failure is the proof the bypass exists.
 */
process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';

const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

// The Host header used to decide whether requireAuth ran at all. Any value that
// did not contain learn.fullsteamahead.ca skipped authentication AND the
// subscription check. fsachat.fullsteamahead.ca is routed through the
// Cloudflare Tunnel to this same container, so on 2026-08-16 a plain GET
// returned 265 KB of paid lesson content to an anonymous caller.
const LEGACY_HOSTS = [
  'fsachat.fullsteamahead.ca',
  'example.invalid',
  '',
];

const PROTECTED_PATHS = [
  '/api/v2/lesson/2A1-1-1',
  '/api/v2/course/2A1/outline',
  '/api/lesson/2A1-1-1',
];

afterAll(async () => {
  await pool.end();
});

describe('legacy-host auth bypass', () => {
  for (const host of LEGACY_HOSTS) {
    for (const path of PROTECTED_PATHS) {
      it(`refuses ${path} with Host "${host || '(empty)'}"`, async () => {
        const res = await request(app).get(path).set('Host', host || 'localhost');
        expect([401, 403, 421]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toMatch(/lesson_code|chapters/);
      });
    }
  }

  it('still refuses protected paths on the platform host without a session', async () => {
    const res = await request(app)
      .get('/api/v2/lesson/2A1-1-1')
      .set('Host', 'learn.fullsteamahead.ca');
    expect(res.status).toBe(401);
  });

  it('leaves /health reachable on any host', async () => {
    const res = await request(app).get('/health').set('Host', 'fsachat.fullsteamahead.ca');
    expect(res.status).toBe(200);
  });
});

describe('host guard', () => {
  it('returns 421 for /api on the legacy host', async () => {
    const res = await request(app)
      .get('/api/v2/course/2A1/outline')
      .set('Host', 'fsachat.fullsteamahead.ca');
    expect(res.status).toBe(421);
  });

  it('does not block /health', async () => {
    const res = await request(app).get('/health').set('Host', 'fsachat.fullsteamahead.ca');
    expect(res.status).toBe(200);
  });
});
