const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const { archiveStaleSavedJobs } = require('../src/scripts/archive_stale_saved_jobs');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'archivestale-%@example.com';

async function createUser(email) {
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, `test-token-${email}`]
  );
  return result.rows[0].id;
}

async function insertSavedJob(userId, status, daysAgo) {
  const result = await pool.query(
    `INSERT INTO saved_jobs (user_id, title, url, status, saved_at)
     VALUES ($1, 'Test Job', 'https://example.com/job', $2, now() - ($3 || ' days')::interval)
     RETURNING id`,
    [userId, status, daysAgo]
  );
  return result.rows[0].id;
}

async function statusOf(id) {
  const result = await pool.query(`SELECT status FROM saved_jobs WHERE id = $1`, [id]);
  return result.rows[0].status;
}

describe('archiveStaleSavedJobs', () => {
  afterEach(async () => {
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('archives only saved jobs older than the threshold, leaving other statuses and fresh jobs untouched', async () => {
    const userId = await createUser('archivestale-test@example.com');
    const staleSaved = await insertSavedJob(userId, 'saved', 100);
    const freshSaved = await insertSavedJob(userId, 'saved', 10);
    const staleApplied = await insertSavedJob(userId, 'applied', 100);
    const staleInterviewing = await insertSavedJob(userId, 'interviewing', 100);
    const alreadyArchived = await insertSavedJob(userId, 'archived', 200);

    const count = await archiveStaleSavedJobs(90);
    expect(count).toBe(1);

    expect(await statusOf(staleSaved)).toBe('archived');
    expect(await statusOf(freshSaved)).toBe('saved');
    expect(await statusOf(staleApplied)).toBe('applied');
    expect(await statusOf(staleInterviewing)).toBe('interviewing');
    expect(await statusOf(alreadyArchived)).toBe('archived');
  });

  it('respects a custom day threshold', async () => {
    const userId = await createUser('archivestale-test-2@example.com');
    const at45Days = await insertSavedJob(userId, 'saved', 45);

    const countAt90 = await archiveStaleSavedJobs(90);
    expect(countAt90).toBe(0);
    expect(await statusOf(at45Days)).toBe('saved');

    const countAt30 = await archiveStaleSavedJobs(30);
    expect(countAt30).toBe(1);
    expect(await statusOf(at45Days)).toBe('archived');
  });
});
