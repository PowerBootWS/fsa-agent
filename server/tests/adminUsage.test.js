const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');

process.env.ADMIN_EMAILS = 'admin@test.example';
const adminRouter = require('../src/routes/admin');

// Mount the router the way src/index.js does: no stub middleware in front of
// it, just cookie-parser (for requireAuth's session cookie) ahead of the
// mount. This is what exercises the real requireAuth -> requireAdminUser
// chain — a prior version of this suite injected req.user directly via a
// stand-in middleware, which unit-tested requireAdminUser in isolation but
// never proved requireAuth was actually wired into the route (it wasn't;
// see the fix-report section of task-7-report.md).
function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

let eventsOwnerId; // the user whose usage_events feed the aggregates
let adminUserId;
let nonAdminUserId;
const ADMIN_TOKEN = 'admin-usage-test-session-token';
const NON_ADMIN_TOKEN = 'non-admin-usage-test-session-token';

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('admin-usage-test@test.example', 'Admin', 'Usage', 'x') RETURNING id`
  );
  eventsOwnerId = rows[0].id;
  await pool.query(
    `INSERT INTO usage_events (user_id, event_type, screen, action, occurred_at)
     VALUES ($1, 'screen_view', '/lobby', NULL, now()),
            ($1, 'screen_view', '/lobby', NULL, now()),
            ($1, 'screen_view', '/jobs',  NULL, now()),
            ($1, 'feature_use', NULL, 'paper_switched', now())`,
    [eventsOwnerId]
  );

  // Two real, session-authenticated callers: one on the ADMIN_EMAILS
  // allowlist, one not. Both go through the actual requireAuth cookie
  // lookup, not an injected req.user.
  const adminRow = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash, current_session_token)
     VALUES ('admin@test.example', 'Admin', 'Caller', 'x', $1) RETURNING id`,
    [ADMIN_TOKEN]
  );
  adminUserId = adminRow.rows[0].id;

  const nonAdminRow = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash, current_session_token)
     VALUES ('student-usage-test@test.example', 'Student', 'Caller', 'x', $1) RETURNING id`,
    [NON_ADMIN_TOKEN]
  );
  nonAdminUserId = nonAdminRow.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = $1', [eventsOwnerId]);
  await pool.query('DELETE FROM platform_users WHERE id = ANY($1::int[])', [
    [eventsOwnerId, adminUserId, nonAdminUserId],
  ]);
  await pool.end();
});

describe('GET /api/admin/usage', () => {
  it('refuses an anonymous request (401) — requireAuth is genuinely in the chain', async () => {
    // This is the regression test for the finding: the route used to have
    // no auth middleware at all in the real app mount, so an anonymous
    // caller with req.user left undefined fell through to requireAdminUser
    // and got a 403 from the allowlist check — never a 401 from requireAuth.
    // That masked the fact that a legitimate owner request, with a valid
    // session cookie, was equally unauthenticated in the real app and also
    // 403'd. Asserting 401 here (not 403) proves requireAuth runs first.
    const res = await request(buildApp()).get('/api/admin/usage');
    expect(res.status).toBe(401);
  });

  it('403s a non-admin with a valid session', async () => {
    const res = await request(buildApp())
      .get('/api/admin/usage')
      .set('Cookie', `fsa_session=${NON_ADMIN_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('returns screen and feature aggregates for an admin', async () => {
    const res = await request(buildApp())
      .get('/api/admin/usage?days=7')
      .set('Cookie', `fsa_session=${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.window_days).toBe(7);

    const lobby = res.body.screens.find((s) => s.screen === '/lobby');
    expect(lobby.views).toBeGreaterThanOrEqual(2);
    expect(lobby.viewers).toBeGreaterThanOrEqual(1);

    const switched = res.body.features.find((f) => f.action === 'paper_switched');
    expect(switched.uses).toBeGreaterThanOrEqual(1);

    // tutor_conversations_started, not tutor_turns: chat_history is one row
    // per (user_email, lesson_id), so this counts conversations begun in
    // the window, not messages exchanged. See the comment at the query.
    expect(res.body.activity).toHaveProperty('tutor_conversations_started');
    expect(res.body.activity).not.toHaveProperty('tutor_turns');
  });

  it('clamps an absurd or non-numeric days parameter to the default', async () => {
    const cookie = `fsa_session=${ADMIN_TOKEN}`;
    const app = buildApp();

    const tooBig = await request(app).get('/api/admin/usage?days=9999').set('Cookie', cookie);
    expect(tooBig.status).toBe(200);
    expect(tooBig.body.window_days).toBe(30);

    const nonsense = await request(app).get('/api/admin/usage?days=nonsense').set('Cookie', cookie);
    expect(nonsense.status).toBe(200);
    expect(nonsense.body.window_days).toBe(30);
  });
});
