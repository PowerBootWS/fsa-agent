const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const requireAuth = require('../src/middleware/requireAuth');

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/whoami', requireAuth, (req, res) => {
    res.json({ id: req.user.id, hasSubscription: !!req.user.subscription_id });
  });
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

describe('requireAuth', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('authenticates a job-only account with no subscription row', async () => {
    const { token } = await createUser({ email: 'jobonly@example.com', withSubscription: false });
    const res = await request(buildTestApp()).get('/whoami').set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasSubscription).toBe(false);
  });

  it('still authenticates an existing paid student with an active subscription', async () => {
    const { token } = await createUser({ email: 'paid@example.com', withSubscription: true });
    const res = await request(buildTestApp()).get('/whoami').set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasSubscription).toBe(true);
  });

  it('rejects an invalid session token', async () => {
    const res = await request(buildTestApp()).get('/whoami').set('Cookie', 'fsa_session=not-a-real-token');
    expect(res.status).toBe(401);
  });
});
