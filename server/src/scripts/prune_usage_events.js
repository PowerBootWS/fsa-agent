// Retention for usage_events (backlog #113): 90 days raw, then daily rollups.
//
// Run from the host crontab — see wiki/projects/fsa-agent.md. That crontab
// line is host state living in no repository; if this box is rebuilt and the
// line is not restored, the table grows without bound and nothing complains.
//
// Idempotent by construction: the rollup upserts on its primary key and the
// delete only touches rows it has just rolled up.
const { pool: defaultPool } = require('../services/database');

async function pruneUsageEvents({ olderThanDays = 90, pool = defaultPool } = {}) {
  const cutoff = `${olderThanDays} days`;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // user_count must be a DISTINCT count taken before the delete — computing
    // it afterwards, or summing rollup rows later, would both be wrong.
    //
    // On the ON CONFLICT path (a day partially rolled up by an earlier run)
    // event_count adds, but user_count takes GREATEST rather than a sum:
    // distinct users cannot be summed across runs without double-counting
    // anyone active in both. It is a floor, and deliberately so — the normal
    // path rolls a whole day at once and hits the plain INSERT.
    const rolled = await client.query(
      `INSERT INTO usage_events_daily (day, event_type, screen, action, event_count, user_count)
       SELECT occurred_at::date,
              event_type,
              COALESCE(screen, ''),
              COALESCE(action, ''),
              COUNT(*)::int,
              COUNT(DISTINCT user_id)::int
         FROM usage_events
        WHERE occurred_at < now() - $1::interval
        GROUP BY 1, 2, 3, 4
       ON CONFLICT (day, event_type, screen, action) DO UPDATE
          SET event_count = usage_events_daily.event_count + EXCLUDED.event_count,
              user_count  = GREATEST(usage_events_daily.user_count, EXCLUDED.user_count)`,
      [cutoff]
    );

    const deleted = await client.query(
      `DELETE FROM usage_events WHERE occurred_at < now() - $1::interval`,
      [cutoff]
    );

    await client.query('COMMIT');
    return { rolled_up: rolled.rowCount, deleted: deleted.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pruneUsageEvents };

if (require.main === module) {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  const olderThanDays = arg ? parseInt(arg.split('=')[1], 10) : 90;
  pruneUsageEvents({ olderThanDays })
    .then((r) => {
      console.log(`[usage] rolled up ${r.rolled_up} day-rows, deleted ${r.deleted} raw events`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[usage] prune failed:', err);
      process.exit(1);
    });
}
