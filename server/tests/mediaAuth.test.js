/**
 * Regression tests for two anonymous paid-content leaks (audit 2026-08-16,
 * closed the same day as the host-header auth bypass but on separate code
 * paths that fix did not touch):
 *
 * 1. `/media` (src/index.js) was `express.static` with no auth in front of it,
 *    on any host, and deliberately outside the /api rate limiter. Verified
 *    live before the fix, no credentials:
 *      GET https://learn.fullsteamahead.ca/media/2A1-1-1/slide-003.mp3
 *        -> 200, audio/mpeg, 380,736 bytes of paid narration.
 *    Paths are fully enumerable ({LESSON_CODE}/slide-NNN.{mp3,png}), so the
 *    whole narration/slide corpus for every paper was scrapeable in a loop.
 *    It was also served with `Cache-Control: public, max-age=14400`, which
 *    Cloudflare honoured at the edge (cf-cache-status: REVALIDATED) — so
 *    origin auth alone is not sufficient; the header must also change to
 *    `private, max-age=300` so no shared cache stores it, while still letting
 *    the requesting student's own browser cache the file briefly (fix round 1,
 *    2026-08-16: `no-store` was rejected — it costs a full narration
 *    re-download and an extra Postgres round-trip per slide revisit, for no
 *    real security gain over `private` alone).
 *
 * 2. `GET /api/platform/lesson-preview/:lessonCode` (src/routes/platform.js)
 *    was mounted with no auth and returned narration_text/summary/key_points
 *    straight from the `lessons` table. Verified live: 200, 44,728 bytes, no
 *    cookie. `grep -rl "lesson-preview"` across the whole repo (excluding
 *    node_modules/.git) found only that one file — no caller anywhere,
 *    including the retired client/ — so the route was deleted outright
 *    rather than given a replacement auth gate.
 *
 * Mirrors tests/progressAuth.test.js: real Postgres via testPool, a session
 * cookie created by inserting directly into platform_users/subscriptions
 * (no HTTP login flow exercised in this suite).
 */
process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';

const fs = require('fs');
const os = require('os');
const path = require('path');

// MEDIA_DIR is read once at module load time in src/index.js, so it must be
// set before requiring the app below. Point it at a throwaway fixture
// directory with one real file, so the "authenticated + file exists" case can
// assert a genuine 200 from the static handler rather than only proving the
// request reached that layer.
const MEDIA_FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-media-test-'));
process.env.MEDIA_DIR = MEDIA_FIXTURE_DIR;
fs.mkdirSync(path.join(MEDIA_FIXTURE_DIR, '2A1-1-1'), { recursive: true });
const FIXTURE_BYTES = Buffer.from('fake mp3 bytes for test fixture');
fs.writeFileSync(path.join(MEDIA_FIXTURE_DIR, '2A1-1-1', 'slide-003.mp3'), FIXTURE_BYTES);
// Slide images go through the same mount as the audio. Covered explicitly
// because on 2026-08-16 "audio plays but no images appear" was reported right
// after this gate shipped, and the only way to answer it without guessing is a
// test that pins both content types. (The real cause was content, not auth:
// 2A1 and 2A2 have zero rows with an image_url and no .png files on disk.)
const PNG_FIXTURE_BYTES = Buffer.from('fake png bytes for test fixture');
fs.writeFileSync(path.join(MEDIA_FIXTURE_DIR, '2A1-1-1', 'slide-004.png'), PNG_FIXTURE_BYTES);

const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';

const OWNER = 'media-auth-owner@example.com';

// Fix round 1 (2026-08-16 review): the original afterEach here did unscoped
// `DELETE FROM subscriptions` / `DELETE FROM platform_users` with no WHERE —
// faithfully mirroring ten other suites in this repo, which is exactly the
// pattern that wiped ten production tables on 2026-08-12 when one of those
// suites ran against a production POSTGRES_DB. This file must be harmless on
// its own regardless of which database it is pointed at, so every delete
// below is scoped to this suite's own fixture email, not to "everything in
// the table." FIXTURE_EMAIL_LIKE intentionally never matches a real student
// address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'media-auth-%@example.com';

afterAll(async () => {
  await pool.end();
  fs.rmSync(MEDIA_FIXTURE_DIR, { recursive: true, force: true });
});

afterEach(async () => {
  await pool.query(
    `DELETE FROM subscriptions
     WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`,
    [FIXTURE_EMAIL_LIKE]
  );
  await pool.query('DELETE FROM platform_users WHERE email LIKE $1', [FIXTURE_EMAIL_LIKE]);
});

async function createUser({ email, withSubscription }) {
  const token = `test-token-${email}`;
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  if (withSubscription) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       VALUES ($1, 'second', 'active', '2A1')`,
      [rows[0].id]
    );
  }
  return { userId: rows[0].id, token };
}

describe('GET /media requires authentication', () => {
  it('rejects an anonymous request with 401 — not 200, not 404', async () => {
    const res = await request(app).get('/media/2A1-1-1/slide-003.mp3').set('Host', LEARN);
    expect(res.status).toBe(401);
  });

  it('rejects an authenticated user with no active subscription (403)', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: false });
    const res = await request(app)
      .get('/media/2A1-1-1/slide-003.mp3')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(403);
  });

  // Asserts the real 200 (not just "reaches the static layer") — a genuine
  // fixture file is written to a throwaway MEDIA_DIR above, so this proves an
  // authenticated, subscribed caller still gets served the actual bytes.
  it('serves the real file to an authenticated subscriber (200)', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    const res = await request(app)
      .get('/media/2A1-1-1/slide-003.mp3')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
    expect(res.headers['content-length']).toBe(String(FIXTURE_BYTES.length));
  });

  // Same mount, different content type. Slide images and narration audio are
  // served by one express.static handler, so nothing can gate one and not the
  // other — this pins that, so the next "images don't load" report can be
  // answered from the test suite instead of by inspecting production.
  it('serves a slide image to an authenticated subscriber (200)', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    const res = await request(app)
      .get('/media/2A1-1-1/slide-004.png')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['content-length']).toBe(String(PNG_FIXTURE_BYTES.length));
    expect(res.headers['cache-control']).toBe('private, max-age=300');
  });

  it('refuses a slide image to an anonymous caller (401)', async () => {
    const res = await request(app).get('/media/2A1-1-1/slide-004.png').set('Host', LEARN);
    expect(res.status).toBe(401);
  });

  it('404s a missing file for an authenticated subscriber, as JSON, not the SPA shell', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    const res = await request(app)
      .get('/media/2A1-1-1/does-not-exist-abc123.mp3')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(res.text || '').not.toMatch(/<!doctype html/i);
  });

  it('sends Cache-Control: private, max-age=300 so no shared cache stores lesson media', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    const res = await request(app)
      .get('/media/2A1-1-1/slide-003.mp3')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
  });
});

describe('GET /api/platform/lesson-preview/:lessonCode is gone', () => {
  it('404s and the body carries no narration content', async () => {
    const res = await request(app).get('/api/platform/lesson-preview/2A1-1-1').set('Host', LEARN);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/narration_text|key_points/);
  });
});
