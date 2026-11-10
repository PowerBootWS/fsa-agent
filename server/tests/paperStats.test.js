const { pool } = require('./testPool');
const { getObjectiveProgress, getLastExam, getWeakChapters } = require('../src/services/paperStats');

// question_responses / user_progress are keyed by email, not user id, so the
// fixture needs no platform_users row; clean up by the fixture email only.
const EMAIL = 'paperstats-fixture@example.com';
// question_responses.question_id is an FK to questions; the test DB has no
// question bank, so the suite owns one fixture question (same pattern as
// quizLobbyData.test.js's 9000xx ids).
const FIXTURE_QUESTION_ID = 910001;

async function cleanup() {
  await pool.query(`DELETE FROM question_responses WHERE user_email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM assessment_attempts WHERE user_email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM chapters WHERE course_id = '2A3' AND title LIKE 'paperStats fixture%'`);
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

  const attempt = (fields) => pool.query(
    `INSERT INTO assessment_attempts (user_email, course_id, kind, started_at, finished_at,
                                      question_count, score, score_pct, chapter_stats, source)
     VALUES ($1, '2A3', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [EMAIL, fields.kind || 'practice_exam', fields.started, fields.finished === undefined ? fields.started : fields.finished,
     fields.count || 4, fields.score || 0, fields.pct, JSON.stringify(fields.stats || {}), fields.source || 'live']);

  // Correction 3 of the attempt-history plan: each answer has its own
  // timestamp, so "rows at MAX(answered_at)" matched exactly one answer and
  // the Home/lobby score was always 0% or 100%.
  it('getLastExam scores the whole latest exam, not its final answer', async () => {
    const answer = (chapter, correct, at) => pool.query(
      `INSERT INTO question_responses (user_email, course_id, chapter_id, session_type, correct, answered_at, question_id)
       VALUES ($1, '2A3', $2, 'practice_exam', $3, $4, $5)`,
      [EMAIL, chapter, correct, at, FIXTURE_QUESTION_ID]);
    await answer('2A3-1', true, '2026-09-02T10:00:00Z');
    await answer('2A3-1', true, '2026-09-02T10:01:00Z');
    await answer('2A3-2', false, '2026-09-02T10:02:00Z');
    await answer('2A3-2', true, '2026-09-02T10:03:00Z');   // last answer: right
    await attempt({ started: '2026-09-02T10:00:00Z', finished: '2026-09-02T10:03:30Z', score: 3, pct: 75,
      stats: { '2A3-1': { correct: 2, total: 2 }, '2A3-2': { correct: 1, total: 2 } } });
    const exam = await getLastExam(pool, EMAIL, '2A3');
    expect(exam.score).toBe(75);
    expect(exam.chapters).toEqual(expect.arrayContaining([
      { chapter_id: '2A3-1', score: 100 },
      { chapter_id: '2A3-2', score: 50 },
    ]));
    expect(new Date(exam.date).toISOString()).toBe('2026-09-02T10:03:30.000Z');
  });

  it('getLastExam picks the latest finished practice exam, ignoring quizzes, retries and unfinished ones', async () => {
    await attempt({ started: '2026-09-01T10:00:00Z', pct: 40 });
    await attempt({ started: '2026-09-05T10:00:00Z', pct: 62, source: 'pre_history' });
    await attempt({ started: '2026-09-06T10:00:00Z', pct: 99, finished: null });
    await attempt({ started: '2026-09-07T10:00:00Z', pct: 100, kind: 'chapter_quiz' });
    await attempt({ started: '2026-09-08T10:00:00Z', pct: 100, kind: 'retry_wrong' });
    expect((await getLastExam(pool, EMAIL, '2A3')).score).toBe(62);
  });

  it('getLastExam is null when the only exam answers predate attempt history', async () => {
    await pool.query(
      `INSERT INTO question_responses (user_email, course_id, chapter_id, session_type, correct, question_id)
       VALUES ($1, '2A3', '2A3-1', 'practice_exam', true, $2)`, [EMAIL, FIXTURE_QUESTION_ID]);
    expect(await getLastExam(pool, EMAIL, '2A3')).toBeNull();
  });

  it('getWeakChapters adds up the last 3 finished practice exams, weakest first, with titles', async () => {
    await pool.query(`INSERT INTO chapters (course_id, chapter_num, title) VALUES
      ('2A3', 1, 'paperStats fixture one'), ('2A3', 2, 'paperStats fixture two')
      ON CONFLICT (course_id, chapter_num) DO NOTHING`);
    await attempt({ started: '2026-08-01T10:00:00Z', pct: 0,                       // 4th most recent: left out
      stats: { '2A3-1': { correct: 0, total: 10 } } });
    await attempt({ started: '2026-09-01T10:00:00Z', pct: 50,
      stats: { '2A3-1': { correct: 3, total: 4 }, '2A3-2': { correct: 1, total: 4 } } });
    await attempt({ started: '2026-09-02T10:00:00Z', pct: 50,
      stats: { '2A3-1': { correct: 4, total: 4 }, '2A3-2': { correct: 2, total: 4 }, Unknown: { correct: 0, total: 1 } } });
    await attempt({ started: '2026-09-03T10:00:00Z', pct: 50,
      stats: { '2A3-2': { correct: 0, total: 2 } } });
    await attempt({ started: '2026-09-04T10:00:00Z', pct: 100, kind: 'chapter_quiz',  // not an exam
      stats: { '2A3-2': { correct: 9, total: 9 } } });
    const weak = await getWeakChapters(pool, EMAIL, '2A3');
    expect(weak.exams).toBe(3);
    expect(weak.chapters).toEqual([
      { chapter_id: '2A3-2', title: expect.stringMatching(/./), correct: 3, total: 10, pct: 30 },
      { chapter_id: '2A3-1', title: expect.stringMatching(/./), correct: 7, total: 8, pct: 88 },
    ]);
  });

  it('getWeakChapters with no exams is empty', async () => {
    expect(await getWeakChapters(pool, EMAIL, '2A3')).toEqual({ exams: 0, chapters: [] });
  });

  it('getObjectiveProgress returns percent 0 for a paper with no lessons', async () => {
    expect(await getObjectiveProgress(pool, EMAIL, 'NOPAPER')).toEqual({ completed: 0, total: 0, percent: 0 });
  });
});
