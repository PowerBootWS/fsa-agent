jest.mock('axios');
const axios = require('axios');
const { pool } = require('./testPool');
const { deleteFixtureUsersByEmailLike } = require('./fixtureCleanup');
const { syncSavedJobStatuses } = require('../src/scripts/sync_saved_job_status');

// Never matches a real student address (no real account uses @example.com).
const FIXTURE_EMAIL_LIKE = 'syncjob-%@example.com';

async function createUser(email) {
  const result = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, current_session_token)
     VALUES ($1, 'Test', 'User', $2) RETURNING id`,
    [email, `test-token-${email}`]
  );
  return result.rows[0].id;
}

async function insertSavedJob(userId, status, sourceJobId) {
  const result = await pool.query(
    `INSERT INTO saved_jobs (user_id, title, url, status, source_job_id)
     VALUES ($1, 'Test Job', 'https://example.com/job', $2, $3)
     RETURNING id`,
    [userId, status, sourceJobId]
  );
  return result.rows[0].id;
}

async function sourceStatusOf(id) {
  const result = await pool.query(`SELECT source_status FROM saved_jobs WHERE id = $1`, [id]);
  return result.rows[0].source_status;
}

describe('syncSavedJobStatuses', () => {
  afterEach(async () => {
    jest.resetAllMocks();
    await deleteFixtureUsersByEmailLike(pool, FIXTURE_EMAIL_LIKE);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('updates source_status for saved/applied/interviewing rows with a source_job_id, skips archived and manual jobs', async () => {
    const userId = await createUser('syncjob-test@example.com');
    const closedJob = await insertSavedJob(userId, 'saved', 'jb-closed');
    const activeJob = await insertSavedJob(userId, 'applied', 'jb-active');
    const archivedJob = await insertSavedJob(userId, 'archived', 'jb-archived');
    const manualJob = await insertSavedJob(userId, 'saved', null);

    axios.get.mockImplementation((url) => {
      if (url.includes('jb-closed')) return Promise.resolve({ data: { status: 'closed' } });
      if (url.includes('jb-active')) return Promise.resolve({ data: { status: 'active' } });
      throw new Error(`unexpected call: ${url}`);
    });

    const result = await syncSavedJobStatuses();

    expect(result.checked).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);
    expect(await sourceStatusOf(closedJob)).toBe('closed');
    expect(await sourceStatusOf(activeJob)).toBe('active');
    expect(await sourceStatusOf(archivedJob)).toBeNull();
    expect(await sourceStatusOf(manualJob)).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('continues past a failed request for one row', async () => {
    const userId = await createUser('syncjob-test-2@example.com');
    const failingJob = await insertSavedJob(userId, 'saved', 'jb-fail');
    const okJob = await insertSavedJob(userId, 'saved', 'jb-ok');

    axios.get.mockImplementation((url) => {
      if (url.includes('jb-fail')) return Promise.reject(new Error('timeout'));
      return Promise.resolve({ data: { status: 'active' } });
    });

    const result = await syncSavedJobStatuses();

    expect(result.checked).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(await sourceStatusOf(failingJob)).toBeNull();
    expect(await sourceStatusOf(okJob)).toBe('active');
  });
});
