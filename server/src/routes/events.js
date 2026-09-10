const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');
const { MAX_BATCH, validateBatch } = require('../services/usageEvents');
const affiliateInvite = require('../services/affiliateInvite');

const COLUMNS = ['user_id', 'event_type', 'screen', 'action', 'props', 'client_session_id', 'occurred_at'];

// POST /api/events — batched first-party usage beacons (backlog #113).
//
// Mounted behind requireAuth but deliberately NOT requireActiveSubscription:
// how a lapsed subscriber behaves in the weeks before they leave is exactly
// the thing worth being able to see.
router.post('/', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const events = req.body?.events;
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events must be an array' });
  }
  if (events.length > MAX_BATCH) {
    return res.status(400).json({ error: `at most ${MAX_BATCH} events per batch` });
  }

  const { rows, dropped } = validateBatch(events, new Date());
  if (dropped > 0) {
    console.warn(`[usage] dropped ${dropped} off-allowlist event(s) from user ${userId}`);
  }

  if (rows.length > 0) {
    const params = [];
    const tuples = rows.map((row, i) => {
      const base = i * COLUMNS.length;
      params.push(userId, row.event_type, row.screen, row.action, row.props, row.client_session_id, row.occurred_at);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    try {
      await pool.query(
        `INSERT INTO usage_events (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`,
        params
      );
    } catch (err) {
      // Telemetry must never be a source of client-visible failure or of retry
      // storms. Log loudly, answer 204: the client swallows errors anyway, and
      // a 5xx here would only turn a database blip into a beacon flood.
      console.error('[usage] insert failed:', err);
    }

    // Fire-and-forget: a student who has now come back enough times to have
    // really used the platform gets the affiliate invite. Reads the rows we
    // just wrote, so it has to run after the insert. maybeInvite() swallows
    // its own errors for the same reason the insert does — the beacon
    // endpoint answers 204 either way.
    // maybeInvite() swallows its own errors, but the .catch() is not
    // redundant: without it an unexpected synchronous throw or a future
    // refactor that stops catching becomes an unhandled rejection on a route
    // that has already answered, and Node can take the process down for it.
    affiliateInvite.maybeInvite(pool, req.user)
      .catch(err => console.error('[usage] affiliate invite check failed:', err.message));
  }

  res.status(204).end();
});

module.exports = router;
