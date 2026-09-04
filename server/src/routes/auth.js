const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../services/database');
const { sendMagicLink, sendPasswordReset } = require('../services/email');
const nurture = require('../services/nurture');

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

    // Block only users who HAD a subscription that is no longer active (lapsed/cancelled
    // paid students) — allow through when there is no subscription row at all (job-only accounts).
    if (user.subscription_status && user.subscription_status !== 'active') {
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

// Why a setup link didn't work, so the page can offer the right way forward
// instead of a dead end. A magic-link token is a 128-bit UUID that only ever
// reaches the student's own inbox, so telling its holder which of the three
// states it is in reveals nothing they didn't already have — and the difference
// matters enormously to them: "already_used" means they are done and just need
// to sign in, "expired" means they need a reset link, only "invalid" is a
// genuinely bad URL. Returns null when the token is good.
//
// Setup links are single-use, and re-tapping the button in the welcome email is
// ordinary behaviour, so already_used is the common case, not the rare one.
async function classifySetupToken(token) {
  if (!token) return 'invalid';

  const result = await pool.query(
    `SELECT used_at, expires_at <= now() AS is_expired
     FROM auth_tokens
     WHERE token = $1 AND type = 'magic_link'`,
    [token]
  );

  if (result.rows.length === 0) return 'invalid';
  if (result.rows[0].used_at !== null) return 'already_used';
  if (result.rows[0].is_expired) return 'expired';
  return null;
}

// GET /api/auth/setup?token=...
router.get('/setup', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Invalid or expired link', reason: 'invalid' });
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
      const reason = (await classifySetupToken(token)) || 'invalid';
      return res.status(400).json({ error: 'Invalid or expired link', reason });
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
      const reason = (await classifySetupToken(token)) || 'invalid';
      return res.status(400).json({ error: 'Invalid or expired link', reason });
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

    // ── Onboarding welcome (fsa-nurture 'onboarding', D0-D21) ──────────────
    //
    // Enrolled HERE, not at provision-user, and deliberately late. Three
    // reasons, all learned the hard way on 2026-09-04:
    //
    // 1. The welcome carries a link to learn.fullsteamahead.ca. Sent at
    //    checkout it arrives BELOW the setup link in the inbox, and a student
    //    reading top-down taps it before they have a password — landing on a
    //    login page they have no credentials for. A student hit the adjacent
    //    version of this the same afternoon (re-tapping a spent setup link)
    //    and contacted support; see the reason-codes fix in this same file.
    // 2. A mail arriving in the same second as the setup link reads as
    //    obviously automated, which is the opposite of what a note from Russ
    //    is for.
    // 3. Waiting until they are actually in leaves a window for a failed
    //    signup to reach support and be resolved before an automated welcome
    //    lands on top of it.
    //
    // NO PASSWORD MEANS NO WELCOME, by owner decision. A student who never
    // completes setup never reaches this line and is never enrolled, which is
    // correct: the email's whole content is how to use an account they cannot
    // get into. They are a support case, not a welcome case. Rare in practice
    // and deliberately not backstopped here.
    //
    // The 10-25 minute jitter is not politeness padding. A fixed offset is as
    // machine-obvious as a zero one; the spread is what makes it read like a
    // person got round to it.
    //
    // class_code gates it because the D0/D2/D5 steps branch on it, and because
    // its absence means this is not a course student. It comes off the active
    // subscription joined above, and is the only paper information available:
    // active_paper is still NULL until they pick one.
    //
    // Fire-and-forget. A nurture outage must never fail account setup — the
    // student is mid-signup and their password is already written.
    if (row.class_code) {
      const delayMinutes = 10 + Math.floor(Math.random() * 16); // 10-25
      nurture
        .enroll({
          email: row.email,
          firstName: row.first_name,
          sequence: 'onboarding',
          source: 'auth-setup',
          attrs: { class_code: row.class_code },
          delayMinutes,
        })
        .catch((err) =>
          console.error(`auth/setup: onboarding enroll failed for ${row.email}:`, err.message)
        );
    }

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

// POST /api/auth/signup
// Free account creation for job-search-only users (no course purchase). Creates no
// subscriptions row — ProtectedRoute routes such accounts with requirePaper={false}
// instead of through /select-paper.
router.post('/signup', async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    if (!email || !password || !first_name?.trim() || !last_name?.trim()) {
      return res.status(400).json({ error: 'Email, password, first name, and last name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const sessionToken = crypto.randomUUID();

    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      const insertResult = await client.query(
        `INSERT INTO platform_users (email, first_name, last_name, password_hash, current_session_token, last_login_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, email, first_name, last_name`,
        [normalizedEmail, first_name.trim(), last_name.trim(), passwordHash, sessionToken]
      );
      user = insertResult.rows[0];

      // Sub-project 3 (AI resume/cover-letter tailoring): every new account gets a small
      // free credit grant so the feature is usable ahead of the Stripe purchase flow
      // (sub-project 2). See server/migrations/011_resume_tailoring.sql for the matching
      // one-time backfill on pre-existing accounts.
      await client.query(
        `INSERT INTO credit_balances (user_id, balance) VALUES ($1, 1)`,
        [user.id]
      );
      await client.query(
        `INSERT INTO credit_transactions (user_id, delta, reason) VALUES ($1, 1, 'signup_grant')`,
        [user.id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await recordLoginEvent(user.id, req, { displaced: false });

    res.cookie(COOKIE_NAME, sessionToken, cookieOptions());

    return res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        active_paper: null,
        class_code: null,
      },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in instead.' });
    }
    console.error('POST /api/auth/signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
