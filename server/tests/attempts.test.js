/**
 * Attempt history API (plan docs/superpowers/plans/2026-11-08-practice-attempt-history.md,
 * Phase B): GET /api/attempts and GET /api/attempts/:id.
 *
 * Identity comes from the session only. Another student's attempt is a 404,
 * never a 403 (no existence leak), and ?user= is never honoured (the IDOR
 * pattern fixed in backlog #88). Review content comes from the per-answer
 * question_snapshot, never from the live questions row, which #138 cutovers
 * edit in place.
 *
 * Real Postgres via testPool (fsa_agent_test only); every DELETE is scoped to
 * this suite's own fixture emails.
 */
const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';
const ME = 'attempts-me@example.com';
const OTHER = 'attempts-other@example.com';
const LAPSED = 'attempts-lapsed@example.com';
const FIXTURE_LIKE = 'attempts-%@example.com';

let questionId;

afterAll(async () => {
  await pool.end();
});

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO questions (course_id, chapter_id, question_text, options, correct_answer)
     VALUES ('2A1', '2A1-3', 'LIVE wording after a cutover', '["live a","live b","live c","live d"]', 3)
     RETURNING id`
  );
  questionId = rows[0].id;
  await pool.query(
    `INSERT INTO chapters (course_id, chapter_num, title) VALUES ('2A1', 3, 'Attempts fixture chapter')
     ON CONFLICT (course_id, chapter_num) DO NOTHING`
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM questions WHERE id = $1', [questionId]);
  await pool.query(`DELETE FROM chapters WHERE course_id = '2A1' AND title = 'Attempts fixture chapter'`);
});

afterEach(async () => {
  await pool.query('DELETE FROM question_responses WHERE user_email LIKE $1', [FIXTURE_LIKE]);
  await pool.query('DELETE FROM assessment_attempts WHERE user_email LIKE $1', [FIXTURE_LIKE]);
  await pool.query(
    `DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`,
    [FIXTURE_LIKE]
  );
  await pool.query('DELETE FROM platform_users WHERE email LIKE $1', [FIXTURE_LIKE]);
});

async function createUser(email, { classCode = 'second', active = true } = {}) {
  const token = `test-token-${email}`;
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  if (active) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       VALUES ($1, $2, 'active', '2A1')`,
      [rows[0].id, classCode]
    );
  }
  return token;
}

async function addAttempt(email, fields = {}) {
  const a = {
    course_id: '2A1', chapter_id: null, kind: 'practice_exam', source: 'live',
    started_at: '2026-11-01T10:00:00Z', finished_at: '2026-11-01T11:00:00Z',
    question_count: 2, score: 1, score_pct: 50, ...fields,
  };
  const { rows } = await pool.query(
    `INSERT INTO assessment_attempts
       (user_email, course_id, chapter_id, kind, source, started_at, finished_at,
        question_count, score, score_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [email, a.course_id, a.chapter_id, a.kind, a.source, a.started_at, a.finished_at,
     a.question_count, a.score, a.score_pct]
  );
  return rows[0].id;
}

async function addAnswer(email, attemptId, position, { correct, selected, snapshot }) {
  await pool.query(
    `INSERT INTO question_responses
       (user_email, question_id, session_type, course_id, chapter_id, correct,
        selected_index, attempt_id, position, question_snapshot)
     VALUES ($1, $2, 'practice_exam', '2A1', '2A1-3', $3, $4, $5, $6, $7)`,
    [email, questionId, correct, selected, attemptId, position,
     snapshot === null ? null : JSON.stringify(snapshot)]
  );
}

const snap = (n) => ({
  question_text: `Shown question ${n}`,
  options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`],
  correct_index: 1,
  explanation: `Because ${n}`,
  chapter_id: '2A1-3',
});

const get = (url, token) => {
  const r = request(app).get(url).set('Host', LEARN);
  return token ? r.set('Cookie', `fsa_session=${token}`) : r;
};

describe('auth', () => {
  it('anonymous list is 401', async () => {
    expect((await get('/api/attempts')).status).toBe(401);
  });

  it('anonymous detail is 401', async () => {
    expect((await get('/api/attempts/1')).status).toBe(401);
  });

  it('no active subscription is 403', async () => {
    const token = await createUser(LAPSED, { active: false });
    expect((await get('/api/attempts', token)).status).toBe(403);
  });
});

describe('GET /api/attempts', () => {
  it('lists only my finished attempts, newest first, with review availability', async () => {
    const token = await createUser(ME);
    await createUser(OTHER);
    const older = await addAttempt(ME, { started_at: '2026-10-01T10:00:00Z', finished_at: '2026-10-01T11:00:00Z' });
    const newer = await addAttempt(ME, {
      kind: 'chapter_quiz', chapter_id: '2A1-3',
      started_at: '2026-11-05T10:00:00Z', finished_at: '2026-11-05T10:20:00Z',
    });
    await addAnswer(ME, newer, 1, { correct: true, selected: 1, snapshot: snap(1) });
    await addAttempt(ME, { finished_at: null, started_at: '2026-11-09T10:00:00Z' }); // unfinished: hidden
    await addAttempt(OTHER, {}); // someone else's

    const res = await get('/api/attempts', token);
    expect(res.status).toBe(200);
    expect(res.body.attempts.map(a => a.id)).toEqual([newer, older]);
    const [quiz, exam] = res.body.attempts;
    expect(quiz).toMatchObject({
      course_id: '2A1', chapter_id: '2A1-3', chapter_title: 'Attempts fixture chapter',
      kind: 'chapter_quiz', score: 1, question_count: 2, score_pct: 50, source: 'live',
      review_available: true,
    });
    expect(exam.review_available).toBe(false);
    expect(exam.chapter_title).toBeNull();
  });

  it('ignores ?user=', async () => {
    const token = await createUser(ME);
    await createUser(OTHER);
    await addAttempt(OTHER, {});
    const res = await get(`/api/attempts?user=${encodeURIComponent(OTHER)}`, token);
    expect(res.status).toBe(200);
    expect(res.body.attempts).toEqual([]);
  });

  it('filters by course and kind', async () => {
    const token = await createUser(ME);
    const exam = await addAttempt(ME, {});
    await addAttempt(ME, { kind: 'chapter_quiz', chapter_id: '2A1-3' });
    await addAttempt(ME, { course_id: '2B1' });
    const res = await get('/api/attempts?course=2A1&kind=practice_exam', token);
    expect(res.body.attempts.map(a => a.id)).toEqual([exam]);
  });

  it('refuses a course outside my subscription (403)', async () => {
    const token = await createUser(ME); // 'second'
    expect((await get('/api/attempts?course=3A1', token)).status).toBe(403);
  });

  it('without a course, leaves out papers I am no longer entitled to', async () => {
    const token = await createUser(ME); // 'second'
    const mine = await addAttempt(ME, {});
    await addAttempt(ME, { course_id: '3A1' }); // from an earlier 3rd Class subscription
    const res = await get('/api/attempts', token);
    expect(res.body.attempts.map(a => a.id)).toEqual([mine]);
  });

  it('rejects an unknown kind (400)', async () => {
    const token = await createUser(ME);
    expect((await get('/api/attempts?kind=nonsense', token)).status).toBe(400);
  });

  it('paginates with limit and offset', async () => {
    const token = await createUser(ME);
    const ids = [];
    for (let d = 1; d <= 3; d++) {
      ids.push(await addAttempt(ME, { started_at: `2026-11-0${d}T10:00:00Z`, finished_at: `2026-11-0${d}T11:00:00Z` }));
    }
    const page = await get('/api/attempts?limit=2&offset=1', token);
    expect(page.body.attempts.map(a => a.id)).toEqual([ids[1], ids[0]]);
  });
});

describe('GET /api/attempts/:id', () => {
  it('returns my attempt with its questions as they were shown, in order', async () => {
    const token = await createUser(ME);
    const id = await addAttempt(ME, {});
    await addAnswer(ME, id, 2, { correct: false, selected: 0, snapshot: snap(2) });
    await addAnswer(ME, id, 1, { correct: true, selected: 1, snapshot: snap(1) });

    const res = await get(`/api/attempts/${id}`, token);
    expect(res.status).toBe(200);
    expect(res.body.attempt).toMatchObject({ id, course_id: '2A1', kind: 'practice_exam', score: 1 });
    expect(res.body.review_available).toBe(true);
    expect(res.body.questions).toEqual([
      { question_text: 'Shown question 1', options: ['a1', 'b1', 'c1', 'd1'], correct_index: 1,
        selected_index: 1, correct: true, explanation: 'Because 1' },
      { question_text: 'Shown question 2', options: ['a2', 'b2', 'c2', 'd2'], correct_index: 1,
        selected_index: 0, correct: false, explanation: 'Because 2' },
    ]);
    // The live question was rewritten after the fact; the attempt must not show it.
    expect(JSON.stringify(res.body)).not.toMatch(/LIVE wording/);
  });

  it("another student's attempt is 404, not 403", async () => {
    const token = await createUser(ME);
    await createUser(OTHER);
    const theirs = await addAttempt(OTHER, {});
    const res = await get(`/api/attempts/${theirs}`, token);
    expect(res.status).toBe(404);
  });

  it('missing and malformed ids are 404', async () => {
    const token = await createUser(ME);
    expect((await get('/api/attempts/999999999', token)).status).toBe(404);
    expect((await get('/api/attempts/abc', token)).status).toBe(404);
  });

  it('an unfinished attempt is 404', async () => {
    const token = await createUser(ME);
    const id = await addAttempt(ME, { finished_at: null });
    expect((await get(`/api/attempts/${id}`, token)).status).toBe(404);
  });

  it('an attempt on a paper I am no longer entitled to is 404', async () => {
    const token = await createUser(ME);
    const id = await addAttempt(ME, { course_id: '3A1' });
    expect((await get(`/api/attempts/${id}`, token)).status).toBe(404);
  });

  it('an attempt with no snapshots says review is unavailable and never falls back to live questions', async () => {
    const token = await createUser(ME);
    const id = await addAttempt(ME, { source: 'pre_history' });
    await addAnswer(ME, id, 1, { correct: true, selected: 3, snapshot: null });
    const res = await get(`/api/attempts/${id}`, token);
    expect(res.status).toBe(200);
    expect(res.body.review_available).toBe(false);
    expect(res.body.questions).toEqual([]);
  });
});
