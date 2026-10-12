// NPS survey (backlog #127, owner spec 2026-10-12).
//
// Who gets asked: a student with an active subscription (any class, 4th Class
// included) whose subscription started 21+ days ago and who has actually used
// the platform, and who has not answered in the last 90 days or closed the
// question in the last 14. The 21 days follow the standing rule that advocacy
// asks come after real experience, never at purchase.
//
// After a 9 or 10 the student is asked whether they already have their
// affiliate link; the answer is recorded so we learn how many promoters never
// found it. 0-6 pings Russ on Telegram with the reason. The daily brief reads
// the table (fsa-dashboard collect_nps.py).
const express = require('express');
const { telegram } = require('fsa-common');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const affiliateClient = require('../services/affiliateClient');
const { createRateLimiter } = require('../utils/rateLimit');

const router = express.Router();
const limiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

const MIN_DAYS_SUBSCRIBED = 21;
const REASK_DAYS = 90;
const DISMISS_BACKOFF_DAYS = 14;
const MAX_REASON = 2000;

async function isEligible(user) {
  if (!user?.subscription_id || user.status !== 'active') return false;
  const { rows: [r] } = await pool.query(
    `SELECT
       (SELECT activated_at <= now() - make_interval(days => $3) FROM subscriptions WHERE id = $2) AS old_enough,
       (SELECT COUNT(DISTINCT client_session_id) >= 3 AND COUNT(*) >= 10
          FROM usage_events WHERE user_id = $1 AND client_session_id IS NOT NULL) AS active_on_platform,
       (SELECT COUNT(*) >= 10 FROM question_responses WHERE user_email = $6) AS answered_questions,
       EXISTS (SELECT 1 FROM nps_responses WHERE user_id = $1 AND outcome = 'answered'
                 AND created_at > now() - make_interval(days => $4)) AS answered_recently,
       EXISTS (SELECT 1 FROM nps_responses WHERE user_id = $1 AND outcome = 'dismissed'
                 AND created_at > now() - make_interval(days => $5)) AS dismissed_recently`,
    [user.id, user.subscription_id, MIN_DAYS_SUBSCRIBED, REASK_DAYS, DISMISS_BACKOFF_DAYS, user.email]
  );
  return !!r.old_enough && (r.active_on_platform || r.answered_questions)
    && !r.answered_recently && !r.dismissed_recently;
}

router.get('/nps/next', requireAuth, async (req, res) => {
  try {
    return res.json({ ask: await isEligible(req.user) });
  } catch (err) {
    console.error('GET /api/platform/nps/next error:', err);
    return res.json({ ask: false });
  }
});

router.post('/nps', requireAuth, async (req, res) => {
  const score = req.body?.score;
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return res.status(400).json({ error: 'score must be a whole number from 0 to 10' });
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, MAX_REASON) : '';
  if (!limiter.check(String(req.user.id))) return res.status(429).json({ error: 'Too many requests' });

  const u = req.user;
  let id;
  try {
    const { rows } = await pool.query(
      `INSERT INTO nps_responses (user_id, class_code, outcome, score, reason)
       VALUES ($1, $2, 'answered', $3, NULLIF($4, '')) RETURNING id`,
      [u.id, u.class_code || null, score, reason]
    );
    id = rows[0].id;
  } catch (err) {
    console.error('POST /api/platform/nps error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const promoter = score >= 9;
  const affiliate = promoter ? await affiliateClient.getSummary(u.email) : null;
  res.status(201).json({ id, promoter, affiliate: affiliate && affiliate.is_affiliate ? affiliate : null });

  if (score <= 6) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)';
    telegram.notifyOwner(
      `📉 NPS ${score}/10 from ${name} <${u.email}> (${u.class_code || 'no class'})\n\n` +
      (reason ? `Why: ${reason}` : 'No reason given.')
    ).catch(err => console.error('nps detractor notify failed (non-fatal):', err.message));
  }
});

router.post('/nps/:id/affiliate-link', requireAuth, async (req, res) => {
  const id = /^\d{1,9}$/.test(String(req.params.id)) ? Number(req.params.id) : null;
  if (id === null || typeof req.body?.had_link !== 'boolean') return res.status(400).json({ error: 'Bad request' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE nps_responses SET had_affiliate_link = $3 WHERE id = $1 AND user_id = $2 AND outcome = 'answered'`,
      [id, req.user.id, req.body.had_link]
    );
    return rowCount ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('POST /api/platform/nps/:id/affiliate-link error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/nps/dismiss', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO nps_responses (user_id, class_code, outcome) VALUES ($1, $2, 'dismissed')`,
      [req.user.id, req.user.class_code || null]
    );
    return res.status(204).end();
  } catch (err) {
    console.error('POST /api/platform/nps/dismiss error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
