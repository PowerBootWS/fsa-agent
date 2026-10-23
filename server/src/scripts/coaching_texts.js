// Text coaching loop, every minute (backlog #139 phase 4).
//
//   docker exec fsa-agent-api-1 node src/scripts/coaching_texts.js
//
// 1. poll GHL for new texts from opted-in students (and Russ's own replies)
// 2. draft replies whose wait is up, and send them to Russ on the coach bot
// 3. send approved drafts that were waiting for quiet hours to end
// An advisory lock stops two runs overlapping if one is slow.
const coachTexts = require('../services/coachTexts');

const LOCK = 139004;

async function runOnce({ pool, deps = {} }) {
  const client = await pool.connect();
  try {
    const { rows: [l] } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!l.ok) return { skipped: 'locked' };
    try {
      const polled = await coachTexts.pollOnce(pool, deps);
      const drafted = await coachTexts.draftDue(pool, deps);
      const sent = await coachTexts.sendScheduled(pool, deps);
      return { ...polled, drafted, scheduled_sent: sent };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } finally {
    client.release();
  }
}

module.exports = { runOnce };

if (require.main === module) {
  const { pool } = require('../services/database');
  runOnce({ pool })
    .then(out => {
      const busy = Object.values(out).some(v => typeof v === 'number' && v > 0);
      if (busy) console.log(`[coaching_texts] ${new Date().toISOString()} ${JSON.stringify(out)}`);
      return pool.end();
    })
    .catch(err => { console.error(`[coaching_texts] ${new Date().toISOString()} failed:`, err.message); process.exit(1); });
}
