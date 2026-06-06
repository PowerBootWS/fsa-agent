const express = require('express');
const crypto = require('crypto');
const { pool } = require('../services/database');
const { sendMagicLink } = require('../services/email');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const PAPER_SWITCH_COOLDOWN_DAYS = parseInt(process.env.PAPER_SWITCH_COOLDOWN_DAYS || '7', 10);

/**
 * Middleware: verify x-internal-secret header matches INTERNAL_SECRET env var.
 */
function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/platform/provision-user
router.post('/provision-user', requireInternalSecret, async (req, res) => {
  try {
    const { email, first_name, last_name, class_code } = req.body;

    if (!email || !first_name || !class_code) {
      return res.status(400).json({ error: 'email, first_name, and class_code are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Upsert platform_users — insert if not exists, then select
    await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [normalizedEmail, first_name, last_name || null]
    );

    const userResult = await pool.query(
      `SELECT id FROM platform_users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = userResult.rows[0];

    // Ensure active subscription exists for this user + class_code
    const subResult = await pool.query(
      `SELECT id FROM subscriptions
       WHERE user_id = $1 AND class_code = $2 AND status = 'active'`,
      [user.id, class_code]
    );

    if (subResult.rows.length === 0) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
         VALUES ($1, $2, 'active', NULL)`,
        [user.id, class_code]
      );
    }

    // Generate magic link token (48h TTL)
    const token = crypto.randomUUID();
    await pool.query(
      `INSERT INTO auth_tokens (user_id, token, type, expires_at)
       VALUES ($1, $2, 'magic_link', now() + interval '48 hours')`,
      [user.id, token]
    );

    await sendMagicLink(normalizedEmail, first_name, token);

    return res.json({ ok: true, user_id: user.id });
  } catch (err) {
    console.error('POST /api/platform/provision-user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/platform/deactivate-user
router.post('/deactivate-user', requireInternalSecret, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const userResult = await pool.query(
      `SELECT id FROM platform_users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query(
      `UPDATE subscriptions
       SET status = 'inactive', deactivated_at = now()
       WHERE user_id = $1 AND status = 'active'`,
      [user.id]
    );

    await pool.query(
      `UPDATE platform_users SET current_session_token = NULL WHERE id = $1`,
      [user.id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/platform/deactivate-user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/platform/switch-paper
router.post('/switch-paper', requireAuth, async (req, res) => {
  try {
    const { paper } = req.body;

    if (!paper) {
      return res.status(400).json({ error: 'paper is required' });
    }

    // requireAuth placeholder passes through — in production req.user will be set
    // For now derive user from session cookie if available
    const sessionToken = req.cookies?.fsa_session;
    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userResult = await pool.query(
      `SELECT u.id, s.id AS sub_id, s.last_paper_switch_at
       FROM platform_users u
       JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       WHERE u.current_session_token = $1`,
      [sessionToken]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { sub_id, last_paper_switch_at } = userResult.rows[0];

    if (last_paper_switch_at) {
      const switchedAt = new Date(last_paper_switch_at);
      const now = new Date();
      const diffMs = now - switchedAt;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays < PAPER_SWITCH_COOLDOWN_DAYS) {
        const daysRemaining = Math.ceil(PAPER_SWITCH_COOLDOWN_DAYS - diffDays);
        return res.status(429).json({ error: 'Paper switch cooldown', days_remaining: daysRemaining });
      }
    }

    await pool.query(
      `UPDATE subscriptions SET active_paper = $1, last_paper_switch_at = now() WHERE id = $2`,
      [paper, sub_id]
    );

    return res.json({ ok: true, active_paper: paper });
  } catch (err) {
    console.error('POST /api/platform/switch-paper error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const sessionToken = req.cookies?.fsa_session;
    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name,
              s.active_paper, s.class_code, s.status, s.last_paper_switch_at
       FROM platform_users u
       JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       WHERE u.current_session_token = $1`,
      [sessionToken]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const row = result.rows[0];
    return res.json({
      id: row.id,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      active_paper: row.active_paper,
      class_code: row.class_code,
      status: row.status,
      last_paper_switch_at: row.last_paper_switch_at,
    });
  } catch (err) {
    console.error('GET /api/platform/me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
