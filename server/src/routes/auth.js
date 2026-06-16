const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../services/database');
const { sendMagicLink, sendPasswordReset } = require('../services/email');

const router = express.Router();

const COOKIE_NAME = 'fsa_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };
}

// Real visitor IP behind the Cloudflare Tunnel rides in CF-Connecting-IP;
// req.ip would be Cloudflare's edge for everyone. Falls back to req.ip, then null.
function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip || null;
}

// Coarse device class from the user agent (mobile / tablet / desktop). Used to
// measure mobile↔desktop switching — deliberately not a fingerprint.
function deviceType(ua) {
  if (!ua) return 'unknown';
  if (/\biPad\b/i.test(ua) || /\bTablet\b/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    return 'tablet';
  }
  if (/Mobi|iPhone|iPod|Windows Phone|Android.*Mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Records a successful login with IP, user agent, device class, and whether it
// displaced a still-active session (another device got bumped — single-session).
// Additive/best-effort — feeds scripts/login_audit.js + scripts/device_switch_report.js.
async function recordLoginEvent(userId, req, { displaced = null } = {}) {
  const ua = req.headers['user-agent'] || null;
  await pool.query(
    `INSERT INTO login_events (user_id, ip_address, user_agent, device_type, displaced_active_session)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, clientIp(req), ua, deviceType(ua), displaced]
  );
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user with active subscription
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.password_hash,
              u.current_session_token AS prior_session_token,
              s.status AS subscription_status, s.active_paper, s.class_code
       FROM platform_users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.email = $1
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.subscription_status !== 'active') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate session token
    const sessionToken = crypto.randomUUID();

    // A non-null prior token means a session was still active on another device
    // and this login just bumped it — the mobile↔desktop friction we want to measure.
    const displaced = !!user.prior_session_token;

    await pool.query(
      `UPDATE platform_users SET current_session_token = $1, last_login_at = now() WHERE id = $2`,
      [sessionToken, user.id]
    );
    await recordLoginEvent(user.id, req, { displaced });

    res.cookie(COOKIE_NAME, sessionToken, cookieOptions());

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        active_paper: user.active_paper,
        class_code: user.class_code,
      },
    });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];

    if (token) {
      await pool.query(
        `UPDATE platform_users SET current_session_token = NULL WHERE current_session_token = $1`,
        [token]
      );
    }

    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/logout error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const userResult = await pool.query(
      `SELECT id, email, first_name FROM platform_users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];

    if (user) {
      const token = crypto.randomUUID();
      await pool.query(
        `INSERT INTO auth_tokens (user_id, token, type, expires_at)
         VALUES ($1, $2, 'password_reset', now() + interval '1 hour')`,
        [user.id, token]
      );

      // Fire-and-forget — don't await so timing attacks can't infer user existence
      sendPasswordReset(user.email, user.first_name, token).catch((err) => {
        console.error('sendPasswordReset error:', err);
      });
    }

    return res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('POST /api/auth/forgot-password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/reset-password?token=...
router.get('/reset-password', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(
      `SELECT id FROM auth_tokens
       WHERE token = $1
         AND type = 'password_reset'
         AND expires_at > now()
         AND used_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    return res.json({ ok: true, valid: true });
  } catch (err) {
    console.error('GET /api/auth/reset-password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    const tokenResult = await pool.query(
      `SELECT id, user_id FROM auth_tokens
       WHERE token = $1
         AND type = 'password_reset'
         AND expires_at > now()
         AND used_at IS NULL`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const { id: tokenId, user_id } = tokenResult.rows[0];
    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `UPDATE platform_users
       SET password_hash = $1, current_session_token = NULL
       WHERE id = $2`,
      [passwordHash, user_id]
    );

    await pool.query(
      `UPDATE auth_tokens SET used_at = now() WHERE id = $1`,
      [tokenId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/reset-password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/setup?token=...
router.get('/setup', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Invalid or expired link' });
    }

    const result = await pool.query(
      `SELECT t.id, t.user_id, u.email, u.first_name
       FROM auth_tokens t
       JOIN platform_users u ON u.id = t.user_id
       WHERE t.token = $1
         AND t.type = 'magic_link'
         AND t.expires_at > now()
         AND t.used_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired link' });
    }

    const { email, first_name } = result.rows[0];
    return res.json({ ok: true, email, first_name });
  } catch (err) {
    console.error('GET /api/auth/setup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/setup
router.post('/setup', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    const tokenResult = await pool.query(
      `SELECT t.id, t.user_id, u.email, u.first_name, u.last_name,
              s.active_paper, s.class_code
       FROM auth_tokens t
       JOIN platform_users u ON u.id = t.user_id
       LEFT JOIN subscriptions s ON s.user_id = t.user_id AND s.status = 'active'
       WHERE t.token = $1
         AND t.type = 'magic_link'
         AND t.expires_at > now()
         AND t.used_at IS NULL`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired link' });
    }

    const row = tokenResult.rows[0];
    const passwordHash = await bcrypt.hash(password, 12);
    const sessionToken = crypto.randomUUID();

    await pool.query(
      `UPDATE platform_users
       SET password_hash = $1, current_session_token = $2, last_login_at = now()
       WHERE id = $3`,
      [passwordHash, sessionToken, row.user_id]
    );
    // Onboarding (first password set) — no prior active session to displace.
    await recordLoginEvent(row.user_id, req, { displaced: false });

    await pool.query(
      `UPDATE auth_tokens SET used_at = now() WHERE id = $1`,
      [row.id]
    );

    res.cookie(COOKIE_NAME, sessionToken, cookieOptions());

    return res.json({
      ok: true,
      user: {
        id: row.user_id,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        active_paper: row.active_paper,
        class_code: row.class_code,
      },
    });
  } catch (err) {
    console.error('POST /api/auth/setup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
