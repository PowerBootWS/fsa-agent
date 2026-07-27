const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();

const { pool } = require('../services/database');
const { PAPERS_SECOND, PAPERS_THIRD } = require('./preview');
const practiceExamTokens = require('../services/practiceExamTokens');
const { createRateLimiter } = require('../utils/rateLimit');
const { sendPracticeExamCode } = require('../services/email');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

const requestCodeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const verifyCodeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function paperListForClass(classCode) {
  return classCode === 'third' ? PAPERS_THIRD : PAPERS_SECOND;
}

// Extracts and verifies the bearer token, returning claims or null.
function getVerifiedClaims(req) {
  const authHeader = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) return null;
  return practiceExamTokens.verify(match[1]);
}

// POST /api/practice-exam/request-code
// Body: { firstName, email, classCode, paperCode, affiliateCode? }
// Validates input, rate-limits, checks for a prior completed attempt on this
// paper, then generates + emails a 6-digit verification code.
router.post('/request-code', async (req, res) => {
  const { firstName, email, classCode, paperCode, affiliateCode } = req.body || {};

  const cleanFirstName = String(firstName || '').trim().slice(0, 100);
  if (!cleanFirstName) {
    return res.status(400).json({ error: 'firstName cannot be blank' });
  }

  const cleanEmail = String(email || '').toLowerCase().trim();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (classCode !== 'second' && classCode !== 'third') {
    return res.status(400).json({ error: 'Invalid classCode' });
  }

  if (!paperListForClass(classCode).includes(paperCode)) {
    return res.status(400).json({ error: 'Invalid paperCode' });
  }

  const limiterKey = `${req.ip}:${cleanEmail}`;
  if (!requestCodeLimiter.check(limiterKey)) {
    return res.status(429).json({ error: 'Too many requests, try again later.' });
  }

  try {
    const existing = await pool.query(
      'SELECT completed_at FROM practice_exam_attempts WHERE email = $1 AND paper_code = $2',
      [cleanEmail, paperCode]
    );
    if (existing.rows.length > 0 && existing.rows[0].completed_at !== null) {
      return res.status(200).json({ success: false, already_used: true });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO practice_exam_attempts
         (email, first_name, class_code, paper_code, verification_code, code_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email, paper_code) DO UPDATE SET
         verification_code = EXCLUDED.verification_code,
         code_expires_at = EXCLUDED.code_expires_at,
         first_name = EXCLUDED.first_name,
         class_code = EXCLUDED.class_code,
         verified_at = NULL`,
      [cleanEmail, cleanFirstName, classCode, paperCode, code, codeExpiresAt]
    );

    try {
      await sendPracticeExamCode(cleanEmail, cleanFirstName, code);
    } catch (err) {
      console.error('practice-exam/request-code email error:', err.message);
      return res.status(500).json({ error: 'Failed to send verification code' });
    }

    // Fire-and-forget lead capture — must never block or fail this response.
    if (process.env.LEAD_CAPTURE_URL) {
      fetch(`${process.env.LEAD_CAPTURE_URL}/practice-exam`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.LEAD_CAPTURE_SHARED_SECRET,
        },
        body: JSON.stringify({
          email: cleanEmail,
          firstName: cleanFirstName,
          affiliateCode: affiliateCode || '',
          classCode,
          paperCode,
        }),
      }).catch((err) => console.error('practice-exam lead-capture error:', err.message));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('practice-exam/request-code error:', err.message);
    res.status(500).json({ error: 'Failed to request verification code' });
  }
});

// POST /api/practice-exam/verify-code
// Body: { email, paperCode, code }
// Verifies the 6-digit code, marks the row verified, and issues a session token.
router.post('/verify-code', async (req, res) => {
  const { email, paperCode, code } = req.body || {};
  const cleanEmail = String(email || '').toLowerCase().trim();
  const cleanCode = String(code || '').trim();

  const limiterKey = `${req.ip}:${cleanEmail}`;
  if (!verifyCodeLimiter.check(limiterKey)) {
    return res.status(429).json({ error: 'Too many requests, try again later.' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM practice_exam_attempts WHERE email = $1 AND paper_code = $2',
      [cleanEmail, paperCode]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No verification code found for this email and paper. Request a new one.' });
    }

    const row = result.rows[0];

    if (new Date(row.code_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This code has expired. Request a new one.' });
    }

    if (String(row.verification_code).trim() !== cleanCode) {
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    if (row.completed_at !== null) {
      return res.status(200).json({ success: false, already_used: true });
    }

    await pool.query(
      'UPDATE practice_exam_attempts SET verified_at = NOW() WHERE id = $1',
      [row.id]
    );

    const token = practiceExamTokens.sign({
      email: cleanEmail,
      classCode: row.class_code,
      paperCode,
    });

    res.json({ success: true, token, firstName: row.first_name });
  } catch (err) {
    console.error('practice-exam/verify-code error:', err.message);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// POST /api/practice-exam/chat
// Body: { message }. Header: Authorization: Bearer <token>.
// Forwards to the Python AI service, exactly like chat.js, but with identity
// forced from the verified token claims rather than the request body.
router.post('/chat', async (req, res) => {
  const claims = getVerifiedClaims(req);
  if (!claims) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }

  try {
    const result = await pool.query(
      'SELECT verified_at, completed_at, first_name FROM practice_exam_attempts WHERE email = $1 AND paper_code = $2',
      [claims.email, claims.paperCode]
    );

    const row = result.rows[0];
    if (!row || row.verified_at === null || row.completed_at !== null) {
      return res.status(403).json({ error: 'This practice exam session is no longer valid.' });
    }

    const payload = {
      user: claims.email,
      lessonId: claims.paperCode,
      message: req.body?.message,
      examConfig: { lead_magnet: true, first_name: row.first_name },
    };

    const response = await axios.post(`${PYTHON_SERVICE_URL}/agent/chat`, payload);
    res.json(response.data);
  } catch (err) {
    console.error('practice-exam/chat error:', err.message);
    res.status(502).json({ error: 'AI service error' });
  }
});

// POST /api/practice-exam/complete
// Header: Authorization: Bearer <token>. Marks the attempt completed (idempotent).
router.post('/complete', async (req, res) => {
  const claims = getVerifiedClaims(req);
  if (!claims) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }

  try {
    await pool.query(
      'UPDATE practice_exam_attempts SET completed_at = NOW() WHERE email = $1 AND paper_code = $2 AND completed_at IS NULL',
      [claims.email, claims.paperCode]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('practice-exam/complete error:', err.message);
    res.status(500).json({ error: 'Failed to complete practice exam' });
  }
});

module.exports = router;
