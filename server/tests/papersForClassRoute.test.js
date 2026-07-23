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

async function createUser({ email, classCode }) {
  const token = `test-token-${email}`;
  const userResult = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
     VALUES ($1, $2, 'active', NULL)`,
    [userId, classCode]
  );
  return { userId, token };
}

describe('GET /api/platform/papers-for-class', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns 4A and 4B for a fourth-class subscriber', async () => {
    const { token } = await createUser({ email: 'fourth-papers@example.com', classCode: 'fourth' });
    const res = await request(buildTestApp())
      .get('/api/platform/papers-for-class')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.papers).toEqual(['4A', '4B']);
    expect(res.body.class_code).toBe('fourth');
  });

  it('still returns the six second-class papers for a second-class subscriber (unchanged)', async () => {
    const { token } = await createUser({ email: 'second-papers@example.com', classCode: 'second' });
    const res = await request(buildTestApp())
      .get('/api/platform/papers-for-class')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.papers).toEqual(['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']);
  });
});
