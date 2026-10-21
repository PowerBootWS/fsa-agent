/**
 * Student-access audit, 2026-10-21. requireActiveSubscription only answered
 * "is this a paying student?". Any subscriber — including a $99/yr 4th Class
 * student — could open any paper's lessons, outlines, media, checkpoints and
 * tutor by changing the code in the URL, and the v2 session/progress routes
 * took the learner id from the request, so one student could read or rewrite
 * another's lesson session. Real app + testPool, scoped fixtures only.
 */
process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';
jest.mock('axios');
const axios = require('axios');
const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';
const FIXTURE = 'paperent-%@example.com';

async function makeStudent(email, classCodes) {
  const token = `test-token-${email}`;
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Paper', 'Test', $2) RETURNING id`, [email, token]);
  for (const c of classCodes) {
    await pool.query(`INSERT INTO subscriptions (user_id, class_code, status) VALUES ($1, $2, 'active')`, [rows[0].id, c]);
  }
  return `fsa_session=${token}`;
}

afterEach(async () => {
  jest.clearAllMocks();
  await pool.query(`DELETE FROM learner_sessions WHERE learner_id LIKE $1`, [FIXTURE]);
  await pool.query(`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`, [FIXTURE]);
  await pool.query(`DELETE FROM platform_users WHERE email LIKE $1`, [FIXTURE]);
});
afterAll(async () => { await pool.end(); });

const get = (path, cookie) => request(app).get(path).set('Host', LEARN).set('Cookie', cookie);
const post = (path, cookie, body) => request(app).post(path).set('Host', LEARN).set('Cookie', cookie).send(body);

describe('paper entitlement', () => {
  it('4th Class A student cannot open a 2nd Class lesson, outline, media or tutor', async () => {
    const c = await makeStudent('paperent-4a@example.com', ['fourth_a']);
    expect((await get('/api/v2/lesson/2A1-1-1', c)).status).toBe(403);
    expect((await get('/api/v2/course/2A1/outline', c)).status).toBe(403);
    expect((await get('/api/lesson/2A1-1-1', c)).status).toBe(403);
    expect((await get('/media/2A1-1-1/slide_1.png', c)).status).toBe(403);
    expect((await post('/api/chat', c, { lessonId: '2A1', message: 'hi' })).status).toBe(403);
    expect(axios.post).not.toHaveBeenCalled();
    expect((await get('/api/exam/2A1/last-results', c)).status).toBe(403);
  });

  it('4th Class A student still reaches their own paper (not 403)', async () => {
    const c = await makeStudent('paperent-4a-own@example.com', ['fourth_a']);
    expect((await get('/api/v2/lesson/4A-1-1', c)).status).not.toBe(403);
    axios.post.mockResolvedValue({ data: { ok: true } });
    expect((await post('/api/chat', c, { lessonId: '4A', message: 'hi' })).status).toBe(200);
  });

  it('a student holding both 4A and 4B reaches both papers', async () => {
    const c = await makeStudent('paperent-4ab@example.com', ['fourth_a', 'fourth_b']);
    expect((await get('/api/v2/course/4A/outline', c)).status).not.toBe(403);
    expect((await get('/api/v2/course/4B/outline', c)).status).not.toBe(403);
  });

  it('3rd Class student cannot open 2nd Class content; 2nd Class student can', async () => {
    const third = await makeStudent('paperent-3@example.com', ['third']);
    const second = await makeStudent('paperent-2@example.com', ['second']);
    expect((await get('/api/v2/lesson/2B1-1-1', third)).status).toBe(403);
    expect((await get('/api/v2/lesson/2B1-1-1', second)).status).not.toBe(403);
  });

  it('an unknown paper code is a 404, not a pass', async () => {
    const c = await makeStudent('paperent-unk@example.com', ['second']);
    expect((await get('/api/v2/lesson/ZZ9-1-1', c)).status).toBe(404);
  });
});

describe('v2 sessions belong to the signed-in student', () => {
  it('ignores a learner_id in the body and refuses to PATCH someone else\'s session', async () => {
    const a = await makeStudent('paperent-sa@example.com', ['second']);
    const b = await makeStudent('paperent-sb@example.com', ['second']);
    const created = await post('/api/v2/session', a, { learner_id: 'paperent-sb@example.com', lesson_code: '2A1-1-1' });
    expect(created.status).toBe(200);
    expect(created.body.learner_id).toBe('paperent-sa@example.com');

    const res = await request(app).patch(`/api/v2/session/${created.body.id}`)
      .set('Host', LEARN).set('Cookie', b).send({ last_section: 5 });
    expect(res.status).toBe(404);
    const own = await request(app).patch(`/api/v2/session/${created.body.id}`)
      .set('Host', LEARN).set('Cookie', a).send({ last_section: 5 });
    expect(own.status).toBe(200);
  });
});
