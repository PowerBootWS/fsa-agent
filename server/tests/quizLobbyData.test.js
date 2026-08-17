const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'qld-%@example.com';

// chapters/questions have no per-file-safe key to scope by — 4A/4B are real
// production course ids (see src/config/papersForClass.js), and chapters'
// primary key is the natural (course_id, chapter_num) pair, not a surrogate
// id, so a delete scoped by course_id alone (the pre-fix pattern) would wipe
// every real chapter for that course, not just this test's two rows, if ever
// pointed at production. Instead: assert nothing already occupies these exact
// keys before inserting (so a real production row makes the INSERT itself
// fail loudly with a duplicate-key error, never gets touched), then the
// teardown below only ever deletes rows this test created.
const FIXTURE_CHAPTERS = [['4A', 1], ['4A', 2], ['4B', 1]];
const FIXTURE_QUESTION_IDS = [900001, 900002, 900003, 900004];

async function assertNoRealDataAtFixtureKeys() {
  const rows = await pool.query(
    `SELECT course_id, chapter_num FROM chapters WHERE ` +
    FIXTURE_CHAPTERS.map((_, i) => `(course_id = $${i * 2 + 1} AND chapter_num = $${i * 2 + 2})`).join(' OR '),
    FIXTURE_CHAPTERS.flat()
  );
  if (rows.rows.length > 0) {
    throw new Error(
      `Refusing to run: chapters already has row(s) at ${JSON.stringify(rows.rows)} — this does ` +
      `not look like a disposable test database. Aborting before inserting/deleting anything.`
    );
  }
  const qRows = await pool.query(`SELECT id FROM questions WHERE id = ANY($1::int[])`, [FIXTURE_QUESTION_IDS]);
  if (qRows.rows.length > 0) {
    throw new Error(
      `Refusing to run: questions already has row(s) at id ${JSON.stringify(qRows.rows.map(r => r.id))} — ` +
      `this does not look like a disposable test database. Aborting before inserting/deleting anything.`
    );
  }
}

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

describe('GET /api/platform/quiz-lobby-data', () => {
  beforeEach(assertNoRealDataAtFixtureKeys);

  afterEach(async () => {
    // Scoped to exactly the tuples/ids this test may have inserted (see
    // assertNoRealDataAtFixtureKeys above for why not "WHERE course_id IN
    // (...)") — question_responses cascades automatically via its FK on
    // questions.id.
    await pool.query(`DELETE FROM questions WHERE id = ANY($1::int[])`, [FIXTURE_QUESTION_IDS]);
    await pool.query(
      `DELETE FROM chapters WHERE ` +
      FIXTURE_CHAPTERS.map((_, i) => `(course_id = $${i * 2 + 1} AND chapter_num = $${i * 2 + 2})`).join(' OR '),
      FIXTURE_CHAPTERS.flat()
    );
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects a non-fourth-class subscriber with 400', async () => {
    const { token } = await createUser({ email: 'qld-not-fourth@example.com', classCodes: ['second'] });
    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(400);
  });

  it('returns both 4A and 4B with chapter-quiz and practice-exam stats, no lesson data', async () => {
    const { token } = await createUser({ email: 'qld-fourth-lobby@example.com', classCodes: ['fourth_a', 'fourth_b'] });

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
        ('qld-fourth-lobby@example.com', 900001, 'chapter_quiz', '4A', '4A-1', true),
        ('qld-fourth-lobby@example.com', 900002, 'chapter_quiz', '4A', '4A-1', true),
        ('qld-fourth-lobby@example.com', 900003, 'chapter_quiz', '4A', '4A-1', false),
        ('qld-fourth-lobby@example.com', 900004, 'chapter_quiz', '4A', '4A-1', true)`
    );

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(['fourth_a', 'fourth_b']).toContain(res.body.class_code);
    expect(Object.keys(res.body.papers)).toEqual(['4A', '4B']);
    expect(res.body.papers['4A'].total_chapters).toBe(2);
    expect(res.body.papers['4A'].chapter_quizzes).toEqual([
      { chapter_id: '4A-1', score: 75, total: 4, correct: 3, last_attempt: expect.anything(), passed: true },
    ]);
    expect(res.body.papers['4A'].next_quiz_chapter_id).toBe('4A-2');
    expect(res.body.papers['4A'].last_exam).toBeNull();
    expect(res.body.papers['4B'].total_chapters).toBe(1);
    expect(res.body.papers['4B'].chapter_quizzes).toEqual([]);
  });
});
