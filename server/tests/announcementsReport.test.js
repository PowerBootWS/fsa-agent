const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const { getReport } = require('../src/services/announcements');

const FIXTURE_EMAIL_LIKE = 'annrep-%@example.com';

async function cleanup() {
  await pool.query(`DELETE FROM announcements WHERE slug LIKE 'test-%'`);
  await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
}

describe('getReport', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('returns null for an unknown slug', async () => {
    expect(await getReport(pool, 'test-missing')).toBeNull();
  });

  it('counts views by action and lists feedback oldest first', async () => {
    const { rows: [a] } = await pool.query(
      `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
       VALUES ('test-rep', 'New Home', 'b', '{everyone}', now(), now() + interval '30 days') RETURNING id`);
    const users = [];
    for (const tag of ['a', 'b', 'c']) {
      const { rows: [u] } = await pool.query(
        `INSERT INTO platform_users (email, first_name, last_name) VALUES ($1, 'Pat', $2) RETURNING id`,
        [`annrep-${tag}@example.com`, tag.toUpperCase()]);
      users.push(u.id);
    }
    await pool.query(`INSERT INTO announcement_views (announcement_id, user_id, action) VALUES ($1,$2,'dismissed'),($1,$3,'cta'),($1,$4,'feedback')`, [a.id, ...users]);
    await pool.query(`INSERT INTO announcement_feedback (announcement_id, user_id, message, created_at) VALUES ($1,$2,'second', now()), ($1,$2,'first', now() - interval '1 minute')`, [a.id, users[2]]);

    const r = await getReport(pool, 'test-rep');
    expect(r.title).toBe('New Home');
    expect(r.eligible).toEqual(expect.any(Number));
    expect(r.seen).toEqual({ dismissed: 1, cta: 1, feedback: 1, total: 3 });
    expect(r.feedback.map(f => f.message)).toEqual(['first', 'second']);
    expect(r.feedback[0]).toMatchObject({ name: 'Pat C', email: 'annrep-c@example.com' });
  });
});
