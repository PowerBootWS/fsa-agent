/**
 * Class switcher (2026-10-21). 4th Class program students keep their 4A/4B
 * papers (jurisdictional rewrites) while also holding 3rd or 2nd Class, so a
 * student can hold several classes. Which one the platform shows must be
 * deterministic and switchable, and ending ONE subscription must not touch the
 * others. Real app + testPool, scoped fixtures.
 */
process.env.USER_UPLOADS_DIR = process.env.USER_UPLOADS_DIR || '/tmp/fsa-test-user-uploads';
jest.mock('axios');
const request = require('supertest');
const { pool } = require('./testPool');
const app = require('../src/index');

const LEARN = 'learn.fullsteamahead.ca';
const FIXTURE = 'clsw-%@example.com';

async function student(email, subs) {
  const token = `test-token-${email}`;
  const { rows } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token, password_hash)
     VALUES ($1, 'Class', 'Switch', $2, 'x') RETURNING id`, [email, token]);
  for (const [code, sub] of subs) {
    await pool.query(`INSERT INTO subscriptions (user_id, class_code, status, stripe_subscription_id) VALUES ($1, $2, 'active', $3)`, [rows[0].id, code, sub]);
  }
  return { id: rows[0].id, cookie: `fsa_session=${token}` };
}
const me = (c) => request(app).get('/api/platform/me').set('Host', LEARN).set('Cookie', c);

afterEach(async () => {
  await pool.query(`DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM platform_users WHERE email LIKE $1)`, [FIXTURE]);
  await pool.query(`DELETE FROM platform_users WHERE email LIKE $1`, [FIXTURE]);
});
afterAll(async () => { await pool.end(); });

describe('class switcher', () => {
  it('shows the highest class by default and switches on request', async () => {
    const s = await student('clsw-a@example.com', [['fourth_a', 'sub_4a'], ['third', 'sub_3']]);
    expect((await me(s.cookie)).body.class_code).toBe('third');

    const list = await request(app).get('/api/platform/classes').set('Host', LEARN).set('Cookie', s.cookie);
    expect(list.body.classes.map(c => c.key)).toEqual(['third', 'fourth']);
    expect(list.body.current).toBe('third');

    const sw = await request(app).post('/api/platform/active-class').set('Host', LEARN).set('Cookie', s.cookie).send({ key: 'fourth' });
    expect(sw.status).toBe(200);
    expect((await me(s.cookie)).body.class_code).toBe('fourth_a');
    // 4A content is reachable, 3rd Class content too (entitlement covers every class held).
    expect((await request(app).get('/api/v2/course/3A1/outline').set('Host', LEARN).set('Cookie', s.cookie)).status).not.toBe(403);
  });

  // Audit A5: a 4A + 4B holder used to get whichever row the JOIN returned first.
  it('a 4A + 4B holder always sees 4A first, whatever order the rows were created in', async () => {
    const s = await student('clsw-ab@example.com', [['fourth_b', 'sub_4b_ab'], ['fourth_a', 'sub_4a_ab']]);
    for (let i = 0; i < 3; i++) expect((await me(s.cookie)).body.class_code).toBe('fourth_a');
  });

  it('refuses to switch to a class the student does not hold', async () => {
    const s = await student('clsw-b@example.com', [['third', 'sub_3b']]);
    const sw = await request(app).post('/api/platform/active-class').set('Host', LEARN).set('Cookie', s.cookie).send({ key: 'second' });
    expect(sw.status).toBe(403);
  });
});

describe('ending one subscription leaves the others alone', () => {
  const secret = 'test-internal-secret';
  const env = process.env;
  beforeEach(() => { process.env = { ...env, INTERNAL_SECRET: secret }; });
  afterEach(() => { process.env = env; });

  it('the end of a 4A year deactivates only 4A, keeps 3rd Class and the session', async () => {
    const s = await student('clsw-c@example.com', [['fourth_a', 'sub_4a_c'], ['third', 'sub_3_c']]);
    const r = await request(app).post('/api/platform/deactivate-user').set('Host', LEARN).set('x-internal-secret', secret)
      .send({ email: 'clsw-c@example.com', stripe_subscription_id: 'sub_4a_c', force_immediate: true });
    expect(r.status).toBe(200);
    const rows = await pool.query(`SELECT class_code, status FROM subscriptions WHERE user_id = $1 ORDER BY class_code`, [s.id]);
    expect(rows.rows).toEqual([{ class_code: 'fourth_a', status: 'inactive' }, { class_code: 'third', status: 'active' }]);
    expect((await me(s.cookie)).status).toBe(200);
  });

  it('only_if_matched with an unknown subscription changes nothing', async () => {
    const s = await student('clsw-d@example.com', [['third', 'sub_3_d']]);
    const r = await request(app).post('/api/platform/deactivate-user').set('Host', LEARN).set('x-internal-secret', secret)
      .send({ email: 'clsw-d@example.com', stripe_subscription_id: 'sub_other', only_if_matched: true, force_immediate: true });
    expect(r.body.matched).toBe(false);
    const rows = await pool.query(`SELECT status FROM subscriptions WHERE user_id = $1`, [s.id]);
    expect(rows.rows[0].status).toBe('active');
  });
});
