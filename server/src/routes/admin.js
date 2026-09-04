const express = require('express');
const { Pool } = require('pg');
const requireAuth = require('../middleware/requireAuth');
const requireAdminUser = require('../middleware/requireAdminUser');

const router = express.Router();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'fsa_agent',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-api-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// POST /api/admin/subscription
// Body: { email, action: 'activate'|'deactivate', class_code?, force_paper_switch?: { paper } }
router.post('/subscription', requireAdminKey, async (req, res) => {
  try {
    const { email, action, class_code, force_paper_switch } = req.body;

    if (!email || !action) {
      return res.status(400).json({ error: 'email and action are required' });
    }

    const userResult = await pool.query(
      'SELECT id FROM platform_users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    if (action === 'activate') {
      // Insert if no subscription exists at all (any status)
      await pool.query(
        `INSERT INTO subscriptions (user_id, class_code, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT DO NOTHING`,
        [userId, class_code || 'third']
      );
      // Reactivate any inactive subscription
      await pool.query(
        `UPDATE subscriptions
         SET status = 'active', deactivated_at = NULL, activated_at = now()
         WHERE user_id = $1 AND status = 'inactive'`,
        [userId]
      );
    } else if (action === 'deactivate') {
      await pool.query(
        `UPDATE subscriptions
         SET status = 'inactive', deactivated_at = now()
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      // Invalidate session
      await pool.query(
        `UPDATE platform_users SET current_session_token = NULL WHERE id = $1`,
        [userId]
      );
    } else {
      return res.status(400).json({ error: 'action must be "activate" or "deactivate"' });
    }

    if (force_paper_switch?.paper) {
      await pool.query(
        `UPDATE subscriptions
         SET active_paper = $1, last_paper_switch_at = now()
         WHERE user_id = $2 AND status = 'active'`,
        [force_paper_switch.paper, userId]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/subscription error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/credits/test-checkout
// Creates a Stripe TEST-mode Checkout Session for the Single Shot pack, for exercising the
// full payment -> webhook -> credit-grant path end-to-end without spending real money. Never
// reachable by a real customer -- gated the same way as every other route in this file.
router.post('/credits/test-checkout', requireAdminKey, async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const priceId = process.env.STRIPE_TEST_PRICE_SPARK_ID;
  if (!priceId) {
    // 500, not 502 — Cloudflare's edge overrides 502/504/52x bodies with its own HTML
    // error page even for a well-formed origin JSON response (see wiki/projects/fsa-agent.md).
    return res.status(500).json({ error: 'STRIPE_TEST_PRICE_SPARK_ID is not set' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id, email, first_name, last_name FROM platform_users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    const Stripe = require('stripe');
    const stripeTest = Stripe(process.env.STRIPE_TEST_SECRET_KEY);

    const customer = await stripeTest.customers.create({
      email: user.email,
      name: `${user.first_name} ${user.last_name}`.trim(),
      metadata: { userId: String(user.id), purpose: 'e2e_test' },
    });

    const baseUrl = process.env.PLATFORM_BASE_URL || 'https://learn.fullsteamahead.ca';
    const session = await stripeTest.checkout.sessions.create({
      mode: 'payment',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: String(user.id), packId: 'spark', purpose: 'credit_pack' },
      success_url: `${baseUrl}/credits?purchase=success`,
      cancel_url: `${baseUrl}/credits?purchase=cancelled`,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('POST /api/admin/credits/test-checkout error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/usage?days=N — first-party platform usage (backlog #113).
//
// Gated by requireAuth (session cookie) + requireAdminUser (ADMIN_EMAILS
// allowlist), not by the x-admin-api-key used by the two routes above: this
// one is called from a browser page, and pasting an API key into a browser
// is not a design. Both are route-scoped, not router.use(...) — the two
// existing x-admin-api-key routes are deliberately called without a session
// cookie, and forcing session auth onto them would break them.
router.get('/usage', requireAuth, requireAdminUser, async (req, res) => {
  const parsed = parseInt(req.query.days, 10);
  const days = Number.isFinite(parsed) && parsed > 0 && parsed <= 365 ? parsed : 30;
  const since = `${days} days`;

  try {
    const [screens, features, learners, activity] = await Promise.all([
      pool.query(
        `SELECT screen, COUNT(*)::int AS views, COUNT(DISTINCT user_id)::int AS viewers
           FROM usage_events
          WHERE event_type = 'screen_view' AND occurred_at >= now() - $1::interval
          GROUP BY screen ORDER BY views DESC`,
        [since]
      ),
      pool.query(
        `SELECT action, COUNT(*)::int AS uses, COUNT(DISTINCT user_id)::int AS users
           FROM usage_events
          WHERE event_type = 'feature_use' AND occurred_at >= now() - $1::interval
          GROUP BY action ORDER BY uses DESC`,
        [since]
      ),
      pool.query(
        `SELECT occurred_at::date AS day, COUNT(DISTINCT user_id)::int AS learners
           FROM usage_events
          WHERE occurred_at >= now() - $1::interval
          GROUP BY 1 ORDER BY 1`,
        [since]
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM question_responses WHERE answered_at >= now() - $1::interval) AS questions_answered,
           (SELECT COUNT(*)::int FROM question_responses WHERE answered_at >= now() - $1::interval AND correct) AS questions_correct,
           (SELECT COUNT(*)::int FROM user_progress WHERE last_accessed >= now() - $1::interval) AS lessons_touched,
           (SELECT COUNT(*)::int FROM practice_exam_attempts WHERE created_at >= now() - $1::interval) AS exams_attempted,
           (SELECT COUNT(*)::int FROM saved_jobs WHERE saved_at >= now() - $1::interval) AS jobs_saved,
           -- chat_history is one row per (user_email, lesson_id), upserted via
           -- ON CONFLICT ... DO UPDATE SET messages = ...; created_at is set once,
           -- at first insert, and never touched again. This counts distinct tutor
           -- conversations STARTED in the window, not messages/turns exchanged --
           -- a long-running conversation from before the window contributes 0
           -- here even if the student sent 40 messages in it this week. Counting
           -- real turns needs an updated_at column on chat_history (follow-up,
           -- out of scope here).
           (SELECT COUNT(*)::int FROM chat_history WHERE created_at >= now() - $1::interval) AS tutor_conversations_started,
           (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active') AS subscribers_active`,
        [since]
      ),
    ]);

    res.json({
      window_days: days,
      active_learners: learners.rows,
      screens: screens.rows,
      features: features.rows,
      activity: activity.rows[0],
    });
  } catch (error) {
    console.error('Error building usage report:', error);
    res.status(500).json({ error: 'Failed to build usage report' });
  }
});

module.exports = router;
