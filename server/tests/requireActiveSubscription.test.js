const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const requireAuth = require('../src/middleware/requireAuth');
const requireActiveSubscription = require('../src/middleware/requireActiveSubscription');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'reqactivesub-%@example.com';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  // Mirror index.js's platform-mode detection so isPlatformMode is set the same way.
  app.use((req, res, next) => {
    req.isPlatformMode = true;
    next();
  });
  app.get('/paid', requireAuth, requireActiveSubscription, (req, res) => res.json({ ok: true }));
  return app;
}

async function createUser({ email, withSubscription }) {
  const token = `test-token-${email}`;
  const userResult = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  const userId = userResult.rows[0].id;
  if (withSubscription) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       VALUES ($1, 'second', 'active', '2A1')`,
      [userId]
    );
  }
  return { userId, token };
}

describe('requireActiveSubscription', () => {
  afterEach(async () => {
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('blocks a job-only account (no subscription) with 403', async () => {
    const { token } = await createUser({ email: 'reqactivesub-jobonly-paid-check@example.com', withSubscription: false });
    const res = await request(buildTestApp()).get('/paid').set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(403);
  });

  it('allows a paid student with an active subscription', async () => {
    const { token } = await createUser({ email: 'reqactivesub-paid-check@example.com', withSubscription: true });
    const res = await request(buildTestApp()).get('/paid').set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
  });
});
