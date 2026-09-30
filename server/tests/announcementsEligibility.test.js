const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const { userGroups, findNextForUser } = require('../src/services/announcements');

const FIXTURE_EMAIL_LIKE = 'annelig-%@example.com';

async function cleanup() {
  await pool.query(`DELETE FROM announcements WHERE slug LIKE 'test-%'`);
  await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
}

// Users are created "yesterday" so announcements starting now are after signup.
async function makeUser(tag, { subs = [], savedJobs = 0 } = {}) {
  const email = `annelig-${tag}@example.com`;
  const { rows: [u] } = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, created_at)
     VALUES ($1, 'Test', 'User', now() - interval '1 day') RETURNING id`, [email]);
  for (const s of subs) {
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper, cancel_at) VALUES ($1, $2, $3, $4, $5)`,
      [u.id, s.class_code, s.status || 'active', s.active_paper || null, s.cancel_at || null]);
  }
  for (let i = 0; i < savedJobs; i++) {
    await pool.query(
      `INSERT INTO saved_jobs (user_id, title, company, url, status) VALUES ($1, 'Operator', 'Plant', 'https://example.com/job', 'saved')`, [u.id]);
  }
  return { id: u.id, email };
}

async function announce(slug, audiences, { startsAgo = '0 minutes', endsIn = '30 days' } = {}) {
  const { rows: [a] } = await pool.query(
    `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
     VALUES ($1, $1, 'Body', $2, now() - $3::interval, now() + $4::interval) RETURNING id`,
    [slug, audiences, startsAgo, endsIn]);
  return a.id;
}

const notAffiliate = async () => false;

describe('announcement eligibility', () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('userGroups: live 2nd Class student', async () => {
    const u = await makeUser('second', { subs: [{ class_code: 'second', active_paper: '2A1' }] });
    expect([...(await userGroups(pool, u.id))].sort()).toEqual(['everyone', 'second', 'students']);
  });

  it('userGroups: job-only account is a job seeker, not a student', async () => {
    const u = await makeUser('jobonly');
    expect([...(await userGroups(pool, u.id))].sort()).toEqual(['everyone', 'job_seekers']);
  });

  it('userGroups: lapsed student with a saved job is a job seeker; without one is neither', async () => {
    const past = { class_code: 'third', active_paper: '3A1', cancel_at: '2026-01-01T00:00:00Z' };
    const withJob = await makeUser('lapsedjob', { subs: [past], savedJobs: 1 });
    const without = await makeUser('lapsed', { subs: [past] });
    expect([...(await userGroups(pool, withJob.id))].sort()).toEqual(['everyone', 'job_seekers']);
    expect([...(await userGroups(pool, without.id))]).toEqual(['everyone']);
  });

  it('shows the newest eligible announcement first', async () => {
    const u = await makeUser('newest');
    await announce('test-older', ['everyone'], { startsAgo: '2 hours' });
    const newer = await announce('test-newer', ['everyone'], { startsAgo: '1 hour' });
    expect((await findNextForUser(pool, u, { isAffiliate: notAffiliate })).id).toBe(newer);
  });

  it('skips announcements for other audiences', async () => {
    const u = await makeUser('skip', { subs: [{ class_code: 'second', active_paper: '2A1' }] });
    await announce('test-fourth', ['fourth_a', 'fourth_b']);
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('never shows an announcement that started before the account existed', async () => {
    const u = await makeUser('late');   // created 1 day ago
    await announce('test-old', ['everyone'], { startsAgo: '2 days' });
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('respects the window', async () => {
    const u = await makeUser('window');
    await announce('test-expired', ['everyone'], { startsAgo: '2 hours', endsIn: '-1 hour' });
    await pool.query(
      `INSERT INTO announcements (slug, title, body, audiences, starts_at, ends_at)
       VALUES ('test-future', 'f', 'b', '{everyone}', now() + interval '1 day', now() + interval '2 days')`);
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('never shows a seen announcement again', async () => {
    const u = await makeUser('seen');
    const id = await announce('test-seen', ['everyone']);
    await pool.query(`INSERT INTO announcement_views (announcement_id, user_id, action) VALUES ($1, $2, 'dismissed')`, [id, u.id]);
    expect(await findNextForUser(pool, u, { isAffiliate: notAffiliate })).toBeNull();
  });

  it('affiliates: asks the affiliate lookup once, only when needed', async () => {
    const u = await makeUser('aff', { subs: [{ class_code: 'second', active_paper: '2A1' }] });
    const id = await announce('test-aff', ['affiliates']);
    const isAffiliate = jest.fn(async () => true);
    expect((await findNextForUser(pool, u, { isAffiliate })).id).toBe(id);
    expect(isAffiliate).toHaveBeenCalledTimes(1);
    expect(isAffiliate).toHaveBeenCalledWith(u.email);
  });

  it('affiliates: a failing lookup means no pop-up, not an error', async () => {
    const u = await makeUser('affdown');
    await announce('test-aff-down', ['affiliates']);
    const isAffiliate = jest.fn(async () => { throw new Error('down'); });
    await expect(findNextForUser(pool, u, { isAffiliate })).resolves.toBeNull();
  });

  it('does not call the affiliate lookup when nothing targets affiliates', async () => {
    const u = await makeUser('noaff');
    await announce('test-all', ['everyone']);
    const isAffiliate = jest.fn(async () => true);
    await findNextForUser(pool, u, { isAffiliate });
    expect(isAffiliate).not.toHaveBeenCalled();
  });

  it('returns only the display fields', async () => {
    const u = await makeUser('shape');
    await announce('test-shape', ['everyone']);
    const a = await findNextForUser(pool, u, { isAffiliate: notAffiliate });
    expect(Object.keys(a).sort()).toEqual(['body', 'cta_label', 'cta_url', 'id', 'title']);
  });
});
