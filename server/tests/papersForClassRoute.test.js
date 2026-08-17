const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'papersclass-%@example.com';

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
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns 4A for a fourth_a subscriber', async () => {
    const { token } = await createUser({ email: 'papersclass-fourth-a@example.com', classCode: 'fourth_a' });
    const res = await request(buildTestApp())
      .get('/api/platform/papers-for-class')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.papers).toEqual(['4A']);
    expect(res.body.class_code).toBe('fourth_a');
  });

  it('returns 4B for a fourth_b subscriber', async () => {
    const { token } = await createUser({ email: 'papersclass-fourth-b@example.com', classCode: 'fourth_b' });
    const res = await request(buildTestApp())
      .get('/api/platform/papers-for-class')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.papers).toEqual(['4B']);
    expect(res.body.class_code).toBe('fourth_b');
  });

  it('still returns the six second-class papers for a second-class subscriber (unchanged)', async () => {
    const { token } = await createUser({ email: 'papersclass-second@example.com', classCode: 'second' });
    const res = await request(buildTestApp())
      .get('/api/platform/papers-for-class')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.papers).toEqual(['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']);
  });
});
