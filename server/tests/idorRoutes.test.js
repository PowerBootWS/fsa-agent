/**
 * Regression tests for backlog #88 (2026-08-16): one student's data reachable
 * by anyone who knew their email address, plus two dead unauthenticated
 * write/read routes.
 *
 * Premise correction (owner-confirmed 2026-08-16): there is no free trial.
 * FSA sells three certification levels outright; the only free surface is
 * the practice exam / diagnostic lead magnet — /api/practice-exam/*,
 * /api/preview/*, /api/diagnostic/*, GET /api/exam/:courseId/chapters, and
 * POST /api/jobs/capture-stash. Nothing else needs to stay unauthenticated.
 *
 * 1. `GET /api/exam/:courseId/last-results?user=<email>` (src/routes/exam.js)
 *    took an arbitrary email as a query parameter with no ownership check —
 *    any address returned that person's exam results. Its one consumer,
 *    client-v2/src/components/PracticeExamLobby.jsx, only ever called it
 *    when leadMagnetMode is false (inside the authenticated platform), so it
 *    is now gated like /api/lesson (requireAuth + requireActiveSubscription)
 *    and identity comes from the session (req.user.email), never the query
 *    string. A caller that still supplies ?user=<other address> has that
 *    value silently ignored — see exam.js for why "ignore" was chosen over
 *    "reject".
 *
 * 2. `POST /api/responses` and `GET /api/responses/chapter-weights/:user/:courseId`
 *    (server/src/routes/responses.js) let anyone write question responses
 *    under any email (feeding isChapterQuizPassed) and read a named
 *    student's per-chapter accuracy, with no auth at all. Zero consumers:
 *      grep -rn "/api/responses" --include="*.js" --include="*.jsx" --include="*.py" --include="*.json" .   -> only the route file + its src/index.js mount
 *      grep -rn "chapter-weights" .                                                                          -> only the route file
 *    checked client-v2/src, the compiled client-v2/build/assets bundle, the
 *    retired client/, ai-service/, and server/src outside the route file
 *    itself. Deleted outright rather than authenticated.
 *
 * 3. `POST /api/chat-history` (server/src/routes/chat-history.js) was
 *    unauthenticated and DB-backed, same zero-consumer search
 *    (grep -rn "/api/chat-history" . -> only the route file + its mount; the
 *    ai-service/agents/researcher.py hit on "chat-history" is its own
 *    save_chat_history() writing to Postgres directly — a different code
 *    path, not a caller of this HTTP route). Deleted outright.
 *
 * NOT touched: GET /api/diagnostic/questions still returns correct_answer —
 * that is the free practice exam grading itself locally
 * (TutorPanel.jsx:41-61), not a leak.
 *
 * Mirrors tests/legacyHostBypass.test.js and tests/mediaAuth.test.js (both
 * written 2026-08-16): real Postgres via testPool, a session cookie created
 * by inserting directly into platform_users/subscriptions, and DELETEs
 * scoped to this suite's own fixture email — never an unscoped DELETE. On
 * 2026-08-12 an unscoped `DELETE FROM platform_users` teardown wiped ten
 * production tables when a suite ran against POSTGRES_DB=fsa_agent (prod).
 */
process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';

// exam.js proxies to PYTHON_SERVICE_URL via axios; mock it so these tests
// don't need ai-service running, and so the mocked response can echo back
// which `user` value it was actually called with — the only reliable way to
// prove the query-string `user` param is ignored rather than honoured.
jest.mock('axios');
const axios = require('axios');

const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';

const OWNER = 'idor-owner@example.com';
const OTHER = 'idor-other@example.com';

// Never matches a real student address (no real account uses @example.com),
// same convention as mediaAuth.test.js's FIXTURE_EMAIL_LIKE.
const FIXTURE_EMAIL_LIKE = 'idor-%@example.com';

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  jest.clearAllMocks();
  await pool.query(
    `DELETE FROM subscriptions
     WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`,
    [FIXTURE_EMAIL_LIKE]
  );
  await pool.query('DELETE FROM platform_users WHERE email LIKE $1', [FIXTURE_EMAIL_LIKE]);
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

describe('GET /api/exam/:courseId/last-results requires authentication', () => {
  it('refuses an anonymous request (401), not 200 with results', async () => {
    const res = await request(app)
      .get('/api/exam/2A1/last-results')
      .set('Host', LEARN);
    expect(res.status).toBe(401);
  });

  it('refuses an anonymous request even with a spoofed ?user= (401)', async () => {
    const res = await request(app)
      .get(`/api/exam/2A1/last-results?user=${encodeURIComponent(OTHER)}`)
      .set('Host', LEARN);
    expect(res.status).toBe(401);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('refuses an authenticated user with no active subscription (403)', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: false });
    const res = await request(app)
      .get('/api/exam/2A1/last-results')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);
    expect(res.status).toBe(403);
  });

  it('an authenticated subscriber gets their OWN results even when ?user= names someone else', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    axios.get.mockImplementation((url, opts) => Promise.resolve({
      data: { available: true, echoed_user: opts.params.user },
    }));

    const res = await request(app)
      .get(`/api/exam/2A1/last-results?user=${encodeURIComponent(OTHER)}`)
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    // Proves identity came from the session, not the query string: the
    // upstream call — and therefore the results returned — is keyed on the
    // authenticated OWNER's email, never the spoofed OTHER value.
    expect(res.body.echoed_user).toBe(OWNER);
    expect(res.body.echoed_user).not.toBe(OTHER);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/agent/exam/2A1/last-results'),
      expect.objectContaining({ params: { user: OWNER } })
    );
  });

  it('an authenticated subscriber gets their own results with no ?user= at all', async () => {
    const { token } = await createUser({ email: OWNER, withSubscription: true });
    axios.get.mockImplementation((url, opts) => Promise.resolve({
      data: { available: true, echoed_user: opts.params.user },
    }));

    const res = await request(app)
      .get('/api/exam/2A1/last-results')
      .set('Host', LEARN)
      .set('Cookie', `fsa_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.echoed_user).toBe(OWNER);
  });
});

describe('GET /api/exam/:courseId/chapters stays public (free practice-exam surface)', () => {
  it('is reachable with no credentials', async () => {
    const res = await request(app)
      .get('/api/exam/2A1/chapters')
      .set('Host', LEARN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('chapters');
  });
});

describe('deleted IDOR/dead routes are gone', () => {
  it('POST /api/responses 404s and does not insert a question response', async () => {
    const res = await request(app)
      .post('/api/responses')
      .set('Host', LEARN)
      .send({ user: OTHER, questionId: 1, sessionType: 'objective_practice', correct: true });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/"ok":true|ok:true/);
  });

  it('GET /api/responses/chapter-weights/:user/:courseId 404s and leaks nothing', async () => {
    const res = await request(app)
      .get(`/api/responses/chapter-weights/${encodeURIComponent(OTHER)}/2A1`)
      .set('Host', LEARN);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/accuracy/);
  });

  it('POST /api/chat-history 404s and does not persist anything', async () => {
    const res = await request(app)
      .post('/api/chat-history')
      .set('Host', LEARN)
      .send({ user: OTHER, lessonId: '2A1-1-1', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(404);
  });
});
