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

describe('GET /api/platform/quiz-lobby-data', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM questions WHERE course_id IN ('4A', '4B')`);
    await pool.query(`DELETE FROM chapters WHERE course_id IN ('4A', '4B')`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects a non-fourth-class subscriber with 400', async () => {
    const { token } = await createUser({ email: 'not-fourth@example.com', classCode: 'second' });
    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(400);
  });

  it('returns both 4A and 4B with chapter-quiz and practice-exam stats, no lesson data', async () => {
    const { token } = await createUser({ email: 'fourth-lobby@example.com', classCode: 'fourth' });

    await pool.query(
      `INSERT INTO chapters (course_id, chapter_num, title) VALUES
        ('4A', 1, 'Intro'), ('4A', 2, 'Forces'), ('4B', 1, 'Lubrication')`
    );
    await pool.query(
      `INSERT INTO questions (id, question_text, options, correct_answer, question_type, chapter_id, course_id)
       VALUES
        (900001, 'Q1', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A'),
        (900002, 'Q2', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A'),
        (900003, 'Q3', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A'),
        (900004, 'Q4', '["A","B","C","D"]'::jsonb, 0, 'chapter_quiz', '4A-1', '4A')`
    );
    await pool.query(
      `INSERT INTO question_responses (user_email, question_id, session_type, course_id, chapter_id, correct)
       VALUES
        ('fourth-lobby@example.com', 900001, 'chapter_quiz', '4A', '4A-1', true),
        ('fourth-lobby@example.com', 900002, 'chapter_quiz', '4A', '4A-1', true),
        ('fourth-lobby@example.com', 900003, 'chapter_quiz', '4A', '4A-1', false),
        ('fourth-lobby@example.com', 900004, 'chapter_quiz', '4A', '4A-1', true)`
    );

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.class_code).toBe('fourth');
    expect(Object.keys(res.body.papers)).toEqual(['4A', '4B']);
    expect(res.body.papers['4A'].total_chapters).toBe(2);
    expect(res.body.papers['4A'].chapter_quizzes).toEqual([
      { chapter_id: '4A-1', score: 75, total: 4, correct: 3, last_attempt: expect.anything(), passed: false },
    ]);
    expect(res.body.papers['4A'].next_quiz_chapter_id).toBe('4A-1');
    expect(res.body.papers['4A'].last_exam).toBeNull();
    expect(res.body.papers['4B'].total_chapters).toBe(1);
    expect(res.body.papers['4B'].chapter_quizzes).toEqual([]);
  });
});
