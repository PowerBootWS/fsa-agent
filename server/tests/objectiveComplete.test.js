const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const platformRouter = require('../src/routes/platform');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'objcomplete-%@example.com';

// lessons.lesson_code is UNIQUE and every real code is '<PAPER>-<CH>-<OBJ>'
// against a paper in src/config/papersForClass.js. 'ZZTEST' is not a paper, so
// this code can never collide with course content — but assert it anyway
// before inserting, same as quizLobbyData.test.js, so a run pointed at a
// database that already has the row aborts instead of deleting it in teardown.
const FIXTURE_LESSON_ID = 900501;
const FIXTURE_LESSON_CODE = 'ZZTEST-1-1';

async function assertNoRealDataAtFixtureKeys() {
  const rows = await pool.query(
    `SELECT id, lesson_code FROM lessons WHERE id = $1 OR lesson_code = $2`,
    [FIXTURE_LESSON_ID, FIXTURE_LESSON_CODE]
  );
  if (rows.rows.length > 0) {
    throw new Error(
      `Refusing to run: lessons already has row(s) at ${JSON.stringify(rows.rows)} — this does ` +
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

async function createUser(email) {
  const token = `test-token-${email}`;
  const userResult = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  await pool.query(
    `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
     VALUES ($1, 'second', 'active', NULL)`,
    [userResult.rows[0].id]
  );
  return { userId: userResult.rows[0].id, token };
}

function post(token, body) {
  const req = request(buildTestApp()).post('/api/platform/objective-complete');
  if (token) req.set('Cookie', `fsa_session=${token}`);
  return req.send(body);
}

// Only true once this file's own INSERT succeeded — a guard failure must clean
// up nothing (jest-circus runs afterEach even when beforeEach throws).
let lessonInserted = false;

describe('POST /api/platform/objective-complete', () => {
  beforeEach(async () => {
    lessonInserted = false;
    await assertNoRealDataAtFixtureKeys();
    await pool.query(
      `INSERT INTO lessons (id, title, lesson_code) VALUES ($1, 'Fixture objective', $2)`,
      [FIXTURE_LESSON_ID, FIXTURE_LESSON_CODE]
    );
    lessonInserted = true;
  });

  afterEach(async () => {
    // user_progress has no ON DELETE CASCADE from either platform_users or
    // lessons, so both scoped deletes are required and must run before their
    // parents go.
    await pool.query(`DELETE FROM user_progress WHERE user_email LIKE $1`, [FIXTURE_EMAIL_LIKE]);
    if (lessonInserted) {
      await pool.query(`DELETE FROM user_progress WHERE lesson_id = $1`, [FIXTURE_LESSON_ID]);
      await pool.query(`DELETE FROM lessons WHERE id = $1`, [FIXTURE_LESSON_ID]);
    }
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await post(null, { lesson_code: FIXTURE_LESSON_CODE, completed: true });
    expect(res.status).toBe(401);
  });

  it('marks an objective complete and stores lesson_code', async () => {
    const email = 'objcomplete-mark@example.com';
    const { token } = await createUser(email);

    const res = await post(token, { lesson_code: FIXTURE_LESSON_CODE, completed: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lesson_code: FIXTURE_LESSON_CODE, completed: true });

    // lesson_code specifically, not just completed: GET /course-structure
    // selects `WHERE lesson_code LIKE $2 AND completed = true`, so a row
    // written with a null lesson_code marks nothing the student can see.
    const row = await pool.query(
      `SELECT completed, lesson_code, lesson_id FROM user_progress WHERE user_email = $1`,
      [email]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({
      completed: true,
      lesson_code: FIXTURE_LESSON_CODE,
      lesson_id: FIXTURE_LESSON_ID,
    });
  });

  it('un-marks an objective that was already complete', async () => {
    const email = 'objcomplete-unmark@example.com';
    const { token } = await createUser(email);

    await post(token, { lesson_code: FIXTURE_LESSON_CODE, completed: true });
    const res = await post(token, { lesson_code: FIXTURE_LESSON_CODE, completed: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lesson_code: FIXTURE_LESSON_CODE, completed: false });

    const row = await pool.query(
      `SELECT completed FROM user_progress WHERE user_email = $1`,
      [email]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].completed).toBe(false);
  });

  it('is idempotent and preserves tutor-written columns on the same row', async () => {
    const email = 'objcomplete-idem@example.com';
    const { token } = await createUser(email);

    // Stand in for what the AI tutor's save_progress writes to this row.
    await pool.query(
      `INSERT INTO user_progress (user_email, lesson_id, lesson_code, score, outcome)
       VALUES ($1, $2, $3, 88, 'strong')`,
      [email, FIXTURE_LESSON_ID, FIXTURE_LESSON_CODE]
    );

    await post(token, { lesson_code: FIXTURE_LESSON_CODE, completed: true });
    await post(token, { lesson_code: FIXTURE_LESSON_CODE, completed: true });

    const row = await pool.query(
      `SELECT completed, score, outcome FROM user_progress WHERE user_email = $1`,
      [email]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({ completed: true, score: 88, outcome: 'strong' });
  });

  it('404s on a lesson_code that does not exist', async () => {
    const { token } = await createUser('objcomplete-missing@example.com');
    const res = await post(token, { lesson_code: 'ZZTEST-9-9', completed: true });
    expect(res.status).toBe(404);
  });

  it('400s when lesson_code is missing', async () => {
    const { token } = await createUser('objcomplete-nocode@example.com');
    const res = await post(token, { completed: true });
    expect(res.status).toBe(400);
  });
});
