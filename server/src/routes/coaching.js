// Student goals (backlog #139 phase 2). See services/coaching.js.
const express = require('express');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter } = require('../utils/rateLimit');
const coaching = require('../services/coaching');

const router = express.Router();
const writeLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 30 });

function parseId(raw) {
  return /^\d{1,9}$/.test(String(raw)) ? Number(raw) : null;
}

function fail(res, err, where) {
  if (err.status === 400) return res.status(400).json({ error: err.message });
  console.error(`${where} error:`, err);
  return res.status(500).json({ error: 'Something went wrong. Try again in a minute.' });
}

function eligibleOr403(req, res) {
  if (coaching.isEligible(req.user)) return true;
  res.status(403).json({ error: 'Goal setting is for 2nd and 3rd Class students.' });
  return false;
}

function limited(req, res) {
  if (writeLimiter.check(String(req.user.id))) return false;
  res.status(429).json({ error: 'Too many changes at once. Try again in a bit.' });
  return true;
}

// Read path never errors the page: a failure means "nothing to show".
router.get('/coaching', requireAuth, async (req, res) => {
  try {
    return res.json(await coaching.getState(pool, req.user));
  } catch (err) {
    console.error('GET /api/platform/coaching error:', err);
    return res.json({ eligible: false });
  }
});

router.post('/coaching/invite', requireAuth, async (req, res) => {
  if (!eligibleOr403(req, res) || limited(req, res)) return undefined;
  try {
    await coaching.answerInvite(pool, req.user, req.body?.answer);
    return res.status(204).end();
  } catch (err) {
    return fail(res, err, 'POST /api/platform/coaching/invite');
  }
});

router.put('/coaching/goal', requireAuth, async (req, res) => {
  if (!eligibleOr403(req, res) || limited(req, res)) return undefined;
  try {
    const goal = await coaching.saveGoal(pool, req.user, req.body);
    return res.json({ goal });
  } catch (err) {
    return fail(res, err, 'PUT /api/platform/coaching/goal');
  }
});

router.post('/coaching/messages/:id/seen', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'Not found' });
  try {
    return (await coaching.markSeen(pool, req.user, id)) ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    return fail(res, err, 'POST /api/platform/coaching/messages/:id/seen');
  }
});

router.post('/coaching/messages/:id/answer', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(404).json({ error: 'Not found' });
  if (limited(req, res)) return undefined;
  try {
    const out = await coaching.answerMessage(pool, req.user, id, String(req.body?.answer || ''));
    return out ? res.json(out) : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    return fail(res, err, 'POST /api/platform/coaching/messages/:id/answer');
  }
});

// Buttons under Russ's follow-up reminders on the coach bot (backlog #139
// phase 3). fsa-webhook-listener receives the tap and calls this with the
// shared internal secret. Russ's own follow-ups only.
function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

router.post('/coaching/internal/followup', requireInternalSecret, async (req, res) => {
  const { action } = req.body || {};
  const id = parseId(req.body?.id);
  const days = { s3: 3, s7: 7 }[action];
  if (id === null || (action !== 'done' && !days)) return res.status(400).json({ error: 'action must be done, s3 or s7 with a numeric id' });
  try {
    let rows;
    if (action === 'done') {
      ({ rows } = await pool.query(
        `UPDATE coaching_commitments SET status = 'closed', resolved_at = COALESCE(resolved_at, now()),
                meta = meta || '{"done":true}'::jsonb
          WHERE id = $1 AND source = 'russ' RETURNING id`, [id]));
      return rows.length ? res.json({ ok: true, text: 'Done.' }) : res.status(404).json({ error: 'Not found' });
    }
    ({ rows } = await pool.query(
      `UPDATE coaching_commitments SET status = 'open', resolved_at = NULL,
              due_at = (((now() AT TIME ZONE $3)::date + $2::int) + interval '9 hours') AT TIME ZONE $3,
              meta = meta - 'reminded_at'
        WHERE id = $1 AND source = 'russ'
        RETURNING to_char(due_at AT TIME ZONE $3, 'Dy Mon DD') AS due`, [id, days, coaching.TZ]));
    return rows.length ? res.json({ ok: true, text: `Snoozed to ${rows[0].due}.` }) : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('POST /api/platform/coaching/internal/followup error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
