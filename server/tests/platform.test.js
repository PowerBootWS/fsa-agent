const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const platformRouter = require('../src/routes/platform');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform', platformRouter);
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

describe('POST /api/platform/switch-paper', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('403s a job-only account with no subscription instead of silently no-op-ing', async () => {
    const { token } = await createUser({ email: 'jobonly-switch@example.com', withSubscription: false });
    const res = await request(buildTestApp())
      .post('/api/platform/switch-paper')
      .set('Cookie', `fsa_session=${token}`)
      .send({ paper: '2A2' });
    expect(res.status).toBe(403);
  });

  it('allows a paid student with an active subscription to switch papers', async () => {
    const { token } = await createUser({ email: 'paid-switch@example.com', withSubscription: true });
    const res = await request(buildTestApp())
      .post('/api/platform/switch-paper')
      .set('Cookie', `fsa_session=${token}`)
      .send({ paper: '2A2' });
    expect(res.status).toBe(200);
    expect(res.body.active_paper).toBe('2A2');
  });
});
