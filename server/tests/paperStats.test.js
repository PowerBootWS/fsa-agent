const { pool } = require('./testPool');
const { getObjectiveProgress, getLastExam } = require('../src/services/paperStats');

// question_responses / user_progress are keyed by email, not user id, so the
// fixture needs no platform_users row; clean up by the fixture email only.
const EMAIL = 'paperstats-fixture@example.com';
// question_responses.question_id is an FK to questions; the test DB has no
// question bank, so the suite owns one fixture question (same pattern as
// quizLobbyData.test.js's 9000xx ids).
const FIXTURE_QUESTION_ID = 910001;

async function cleanup() {
  await pool.query(`DELETE FROM question_responses WHERE user_email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM user_progress WHERE user_email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM questions WHERE id = $1`, [FIXTURE_QUESTION_ID]);
}

describe('paperStats', () => {
  beforeEach(async () => {
    await cleanup();
    await pool.query(
      `INSERT INTO questions (id, question_text, options, correct_answer, question_type, chapter_id, course_id)
       VALUES ($1, 'Fixture', '["A","B"]'::jsonb, 0, 'chapter_quiz', '2A3-1', '2A3')`,
      [FIXTURE_QUESTION_ID]);
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('getLastExam returns null when there is no practice exam', async () => {
    expect(await getLastExam(pool, EMAIL, '2A3')).toBeNull();
  });

  it('getLastExam scores only the most recent attempt, per chapter', async () => {
    const insert = (chapter, correct, at) => pool.query(
      `INSERT INTO question_responses (user_email, course_id, chapter_id, session_type, correct, answered_at, question_id)
       VALUES ($1, '2A3', $2, 'practice_exam', $3, $4, $5)`,
      [EMAIL, chapter, correct, at, FIXTURE_QUESTION_ID]);
    await insert('2A3-1', false, '2026-09-01T10:00:00Z');           // older attempt, ignored
    await insert('2A3-1', true, '2026-09-02T10:00:00Z');
    await insert('2A3-2', false, '2026-09-02T10:00:00Z');
    const exam = await getLastExam(pool, EMAIL, '2A3');
    expect(exam.score).toBe(50);
    expect(exam.chapters).toEqual(expect.arrayContaining([
      { chapter_id: '2A3-1', score: 100 },
      { chapter_id: '2A3-2', score: 0 },
    ]));
  });

  it('getObjectiveProgress returns percent 0 for a paper with no lessons', async () => {
    expect(await getObjectiveProgress(pool, EMAIL, 'NOPAPER')).toEqual({ completed: 0, total: 0, percent: 0 });
  });
});
