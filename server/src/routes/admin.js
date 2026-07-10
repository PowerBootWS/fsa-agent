const express = require('express');
const { Pool } = require('pg');

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
    return res.status(502).json({ error: 'STRIPE_TEST_PRICE_SPARK_ID is not set' });
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

module.exports = router;
