/**
 * Regression tests for the unauthenticated /api/progress endpoint (audit 2026-08-12).
 *
 * `app.use('/api/progress', progressRouter)` in src/index.js mounted the router
 * with no auth middleware at all, unlike every sibling route (/api/lesson,
 * /api/chat, /api/v2/*), which all sit behind auth + requireActiveSubscription.
 *
 * Verified live before the fix, on the public URL, with no credentials:
 *   GET https://learn.fullsteamahead.ca/api/progress/84?user=<student email>
 *   -> 200 {"user_email":"...","score":100,"struggles":[],"attempts":{...},...}
 * The same request against https://fsachat.fullsteamahead.ca also returned 200,
 * so a host-conditional platformAuth would not have closed it — requireAuth is
 * applied unconditionally. No client (v1, v2 or ai-service) calls this route.
 *
 * POST /api/progress was likewise open: anyone could overwrite any student's
 * score, completion flag and session notes by naming their email in the body.
 */
process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';

const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';
const LEGACY = 'fsachat.fullsteamahead.ca';

const OWNER = 'progress-owner@example.com';
const OTHER = 'progress-other@example.com';

afterAll(async () => {
  await pool.end();
});

async function createUser({ email, withSubscription }) {
  const token = `test-token-${email}`;
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, token]
  );
  if (withSubscription) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       VALUES ($1, 'second', 'active', '2A1')`,
      [rows[0].id]
    );
  }
  return { userId: rows[0].id, token };
}

describe('/api/progress requires authentication', () => {
  beforeAll(async () => {
    // The test DB is provisioned from the platform migrations and has no
    // user_progress table; create the columns this route touches.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_progress (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        lesson_id INTEGER,
        score INTEGER DEFAULT 0,
        struggles JSONB,
        attempts JSONB DEFAULT '{}'::jsonb,
        complexity_level INTEGER DEFAULT 3,
        completed BOOLEAN DEFAULT false,
        last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        outcome VARCHAR(20),
        session_notes TEXT,
        understanding_level VARCHAR(50) DEFAULT 'good',
        current_section INTEGER DEFAULT 0,
        lesson_code VARCHAR(20),
        CONSTRAINT uq_user_progress_user_lesson UNIQUE (user_email, lesson_id)
      )`);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM user_progress`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  it('rejects an unauthenticated GET on the platform host', async () => {
    const res = await request(app).get('/api/progress/84?user=someone@example.com').set('Host', LEARN);
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated GET on the legacy host too', async () => {
    // Task 3's host guard (requireLearnHost, mounted before the auth middleware)
    // now intercepts every /api/* request on a non-platform Host and returns 421
    // before requireAuth ever runs — still an unconditional refusal, just at an
    // earlier layer, so this is 421 rather than 401.
    const res = await request(app).get('/api/progress/84?user=someone@example.com').set('Host', LEGACY);
    expect(res.status).toBe(421);
  });

  it('does not leak a real progress row to an unauthenticated caller', async () => {
    await pool.query(
      `INSERT INTO user_progress (user_email, lesson_id, score, outcome, lesson_code)
       VALUES ($1, 84, 100, 'strong', '2A2-1-3')`,
      [OWNER]
    );

    const res = await request(app).get(`/api/progress/84?user=${encodeURIComponent(OWNER)}`).set('Host', LEARN);

    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(OWNER);
  });

  it('rejects an unauthenticated POST', async () => {
    const res = await request(app)
      .post('/api/progress')
      .set('Host', LEARN)
      .send({ user: OWNER, lessonId: 84, score: 5 });

    expect(res.status).toBe(401);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM user_progress`);
    expect(rows[0].n).toBe(0);
  });

  it('rejects an authenticated user with no active subscription', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: false });
    const res = await request(app)
      .get('/api/progress/84')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(403);
  });

  it('still serves an authenticated subscriber their own progress', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    await pool.query(
      `INSERT INTO user_progress (user_email, lesson_id, score, outcome, lesson_code)
       VALUES ($1, 84, 72, 'strong', '2A2-1-3')`,
      [OWNER]
    );

    const res = await request(app)
      .get('/api/progress/84')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user_email).toBe(OWNER);
    expect(res.body.score).toBe(72);
  });
});

describe('/api/progress is scoped to the authenticated user', () => {
  afterEach(async () => {
    await pool.query(`DELETE FROM user_progress`);
    await pool.query(`DELETE FROM subscriptions`);
    await pool.query(`DELETE FROM platform_users`);
  });

  it('ignores a ?user= naming a different student', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    await pool.query(
      `INSERT INTO user_progress (user_email, lesson_id, score, lesson_code)
       VALUES ($1, 84, 99, '2A2-1-3')`,
      [OTHER]
    );

    const res = await request(app)
      .get(`/api/progress/84?user=${encodeURIComponent(OTHER)}`)
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('writes a POST against the session owner, not the body-supplied user', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });

    const res = await request(app)
      .post('/api/progress')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`)
      .send({ user: OTHER, lessonId: 84, score: 41 });

    expect(res.status).toBe(200);

    const { rows } = await pool.query(`SELECT user_email, score FROM user_progress`);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_email).toBe(OWNER);
    expect(rows[0].score).toBe(41);
  });
});
