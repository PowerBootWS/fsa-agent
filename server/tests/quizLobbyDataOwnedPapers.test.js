const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'qlop-%@example.com';

// chapters has no per-file-safe key to scope by — 4A/4B are real production
// course ids (see src/config/papersForClass.js), and chapters' primary key is
// the natural (course_id, chapter_num) pair, not a surrogate id, so a delete
// scoped by course_id alone (the pre-fix pattern) would wipe every real
// chapter for that course, not just this test's rows, if ever pointed at
// production. Instead: assert nothing already occupies these exact keys
// before inserting (so a real production row makes the INSERT itself fail
// loudly with a duplicate-key error, never gets touched), then teardown only
// ever deletes rows this test created.
const FIXTURE_CHAPTERS = [['4A', 1], ['4B', 1]];

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

// Fix round 1 (2026-08-17 review): jest-circus runs afterEach UNCONDITIONALLY
// — a thrown beforeEach only skips subsequent beforeEach hooks and the test
// body, not afterEach. So the previous version of this file, which ran the
// exact-tuple DELETE in afterEach unconditionally, would delete the very rows
// assertNoRealDataAtFixtureKeys had just correctly detected and refused to
// touch: guard throws (real data found, nothing inserted) -> test body never
// runs -> afterEach still fires -> DELETE removes the real rows anyway. This
// flag is the fix: only set true right after this test's own chapters INSERT
// actually succeeds, reset false at the top of every beforeEach (before the
// guard, so a throw leaves it false), and checked in afterEach so a guard
// failure — or any other failure before the insert — cleans up nothing. Once
// true, deleting BOTH fixture tuples is still safe even for the tests that
// only inserted one of them — the other simply never existed, so its DELETE
// is a no-op — because the guard already proved neither was real data.
let chaptersInserted = false;

describe('GET /api/platform/quiz-lobby-data — owned papers only', () => {
  beforeEach(async () => {
    chaptersInserted = false;
    await assertNoRealDataAtFixtureKeys();
  });

  afterEach(async () => {
    // Scoped to exactly the tuples this test may have inserted (see
    // assertNoRealDataAtFixtureKeys above for why not "WHERE course_id IN
    // (...)"), and only run at all if this test's own insert actually
    // happened (see the flag comment above).
    if (chaptersInserted) {
      await pool.query(
        `DELETE FROM chapters WHERE ` +
        FIXTURE_CHAPTERS.map((_, i) => `(course_id = $${i * 2 + 1} AND chapter_num = $${i * 2 + 2})`).join(' OR '),
        FIXTURE_CHAPTERS.flat()
      );
    }
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns only 4A for a student who owns just fourth_a', async () => {
    const { token } = await createUser({ email: 'qlop-a-only@example.com', classCodes: ['fourth_a'] });
    await pool.query(`INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4A', 1, 'Intro')`);
    chaptersInserted = true;

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers)).toEqual(['4A']);
  });

  it('returns only 4B for a student who owns just fourth_b', async () => {
    const { token } = await createUser({ email: 'qlop-b-only@example.com', classCodes: ['fourth_b'] });
    await pool.query(`INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4B', 1, 'Lubrication')`);
    chaptersInserted = true;

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers)).toEqual(['4B']);
  });

  it('returns both papers for a student who owns fourth_a and fourth_b', async () => {
    const { token } = await createUser({ email: 'qlop-both-owned@example.com', classCodes: ['fourth_a', 'fourth_b'] });
    await pool.query(
      `INSERT INTO chapters (course_id, chapter_num, title) VALUES ('4A', 1, 'Intro'), ('4B', 1, 'Lubrication')`
    );
    chaptersInserted = true;

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.papers).sort()).toEqual(['4A', '4B']);
  });

  it('still rejects a 2nd/3rd Class subscriber with 400', async () => {
    const { token } = await createUser({ email: 'qlop-second-only@example.com', classCodes: ['second'] });

    const res = await request(buildTestApp())
      .get('/api/platform/quiz-lobby-data')
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(400);
  });
});
