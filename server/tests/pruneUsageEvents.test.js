const { pool } = require('./testPool');
const { pruneUsageEvents } = require('../src/scripts/prune_usage_events');

let userId;
let otherId;

beforeAll(async () => {
  const a = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('prune-a@test.example', 'A', 'A', 'x') RETURNING id`
  );
  const b = await pool.query(
    `INSERT INTO platform_users (email, first_name, last_name, password_hash)
     VALUES ('prune-b@test.example', 'B', 'B', 'x') RETURNING id`
  );
  userId = a.rows[0].id;
  otherId = b.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = ANY($1)', [[userId, otherId]]);
  await pool.query("DELETE FROM usage_events_daily WHERE screen = '/lobby'");

  // Two users, same old day and screen → 2 events, 2 distinct users.
  await pool.query(
    `INSERT INTO usage_events (user_id, event_type, screen, occurred_at)
     VALUES ($1, 'screen_view', '/lobby', now() - interval '200 days'),
            ($2, 'screen_view', '/lobby', now() - interval '200 days'),
            ($1, 'screen_view', '/lobby', now() - interval '1 day')`,
    [userId, otherId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM usage_events WHERE user_id = ANY($1)', [[userId, otherId]]);
  await pool.query("DELETE FROM usage_events_daily WHERE screen = '/lobby'");
  await pool.query('DELETE FROM platform_users WHERE id = ANY($1)', [[userId, otherId]]);
  await pool.end();
});

describe('pruneUsageEvents', () => {
  it('rolls up rows older than the window and deletes them', async () => {
    const result = await pruneUsageEvents({ olderThanDays: 90, pool });
    expect(result.deleted).toBe(2);

    const { rows } = await pool.query(
      "SELECT event_count, user_count FROM usage_events_daily WHERE screen = '/lobby'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_count).toBe(2);
    expect(rows[0].user_count).toBe(2); // distinct users, counted BEFORE deletion
  });

  it('leaves rows inside the window alone', async () => {
    await pruneUsageEvents({ olderThanDays: 90, pool });
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usage_events WHERE user_id = ANY($1)', [
      [userId, otherId],
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('is idempotent — a second run changes nothing', async () => {
    await pruneUsageEvents({ olderThanDays: 90, pool });
    const second = await pruneUsageEvents({ olderThanDays: 90, pool });
    expect(second.deleted).toBe(0);

    const { rows } = await pool.query(
      "SELECT event_count, user_count FROM usage_events_daily WHERE screen = '/lobby'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_count).toBe(2);
  });

  it('rejects a negative olderThanDays and deletes nothing', async () => {
    await expect(pruneUsageEvents({ olderThanDays: -5, pool })).rejects.toThrow(/positive integer/);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usage_events WHERE user_id = ANY($1)', [
      [userId, otherId],
    ]);
    expect(rows[0].n).toBe(3); // both old rows and the recent row survive untouched
  });

  it('rejects a non-numeric olderThanDays and deletes nothing', async () => {
    await expect(pruneUsageEvents({ olderThanDays: 'not-a-number', pool })).rejects.toThrow(/positive integer/);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usage_events WHERE user_id = ANY($1)', [
      [userId, otherId],
    ]);
    expect(rows[0].n).toBe(3);
  });

  it('writes empty strings, not NULLs, into the rollup key columns', async () => {
    await pool.query(
      `INSERT INTO usage_events (user_id, event_type, action, occurred_at)
       VALUES ($1, 'feature_use', 'paper_switched', now() - interval '200 days')`,
      [userId]
    );
    await pruneUsageEvents({ olderThanDays: 90, pool });
    const { rows } = await pool.query(
      "SELECT screen FROM usage_events_daily WHERE action = 'paper_switched'"
    );
    expect(rows[0].screen).toBe('');
    await pool.query("DELETE FROM usage_events_daily WHERE action = 'paper_switched'");
  });
});
