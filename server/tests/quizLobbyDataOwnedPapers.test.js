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

async function createUser({ email, classCodes }) {
  const token = `test-token-${email}`;
  const userResult = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  const userId = userResult.rows[0].id;
  for (const classCode of classCodes) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       VALUES ($1, $2, 'active', NULL)`,
      [userId, classCode]
    );
  }
  return { userId, token };
}

describe('GET /api/platform/quiz-lobby-data — owned papers only', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM chapters WHERE course_id IN ('4A', '4B')`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns only 4A for a student who owns just fourth_a', async () => {
    const { token } = await createUser({ email: 'a-only@example.com', classCodes: ['fourth_a'] });
    await pool.query(`INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4A', 1, 'Intro')`);

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers)).toEqual(['4A']);
  });

  it('returns only 4B for a student who owns just fourth_b', async () => {
    const { token } = await createUser({ email: 'b-only@example.com', classCodes: ['fourth_b'] });
    await pool.query(`INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4B', 1, 'Lubrication')`);

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers)).toEqual(['4B']);
  });

  it('returns both papers for a student who owns fourth_a and fourth_b', async () => {
    const { token } = await createUser({ email: 'both-owned@example.com', classCodes: ['fourth_a', 'fourth_b'] });
    await pool.query(
      `INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4A', 1, 'Intro'), ('4B', 1, 'Lubrication')`
    );

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers).sort()).toEqual(['4A', '4B']);
  });

  it('still rejects a 2nd/3rd Class subscriber with 400', async () => {
    const { token } = await createUser({ email: 'second-only@example.com', classCodes: ['second'] });

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(400);
  });
});
