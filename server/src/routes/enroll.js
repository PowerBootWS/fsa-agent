const express = require('express');
const router = express.Router();
const db = require('../services/database');

/**
 * POST /api/enroll
 *
 * Register or update a student. Called from your CRM automation when a
 * learner enrolls in a course. Accepts JSON body or query-string params.
 *
 * Body / query params:
 *   email      (required) — student email address
 *   first_name (required) — student first name
 *   last_name  (optional) — student last name
 *
 * Returns:
 *   201 { success: true, user: { email, first_name, last_name } }  — created
 *   200 { success: true, user: { email, first_name, last_name } }  — updated
 *   400 { error: '...' }  — validation failure
 */
router.post('/', async (req, res) => {
  // Accept values from JSON body or query string
  const email      = (req.body.email      || req.query.email      || '').trim().toLowerCase();
  const first_name = (req.body.first_name || req.query.first_name || '').trim();
  const last_name  = (req.body.last_name  || req.query.last_name  || '').trim();

  // Validation
  if (!email) {
    return res.status(400).json({ error: 'Missing required field: email' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (!first_name) {
    return res.status(400).json({ error: 'Missing required field: first_name' });
  }

  try {
    const { user, created } = await db.upsertUser({ email, first_name, last_name });
    return res.status(created ? 201 : 200).json({ success: true, user });
  } catch (err) {
    console.error('Error in /api/enroll:', err);
    return res.status(500).json({ error: 'Failed to enroll user' });
  }
});

module.exports = router;
