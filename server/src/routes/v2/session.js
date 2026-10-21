// fsa-agent/server/src/routes/v2/session.js
const express = require('express');
const router = express.Router();
const db = require('../../services/database');
const { requirePaperEntitlement } = require('../../middleware/requirePaperEntitlement');

// Sessions belong to the signed-in student. The learner id used to come from the
// request body (the client sent its own email), so any subscriber could read or
// rewrite another student's lesson session. Student-access audit, 2026-10-21.
const sameLearner = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// POST /api/v2/session — create or resume a session
// Body: { learner_id, lesson_code }
router.post('/', requirePaperEntitlement(req => req.body && req.body.lesson_code), async (req, res) => {
  const learner_id = req.user && req.user.email;
  const { lesson_code } = req.body;
  if (!learner_id || !lesson_code) {
    return res.status(400).json({ error: 'learner_id and lesson_code required' });
  }
  try {
    const session = await db.upsertLearnerSession(learner_id, lesson_code);
    res.json(session);
  } catch (err) {
    console.error('session create error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// PATCH /api/v2/session/:id — update progress
// Body: { last_section?, max_section?, sections_viewed?, checkpoint_entry? }
// max_section is the furthest slide reached by Next; check-ins at or before it
// are not shown again. Ignored unless a non-negative integer.
router.patch('/:id', async (req, res) => {
  const { last_section, max_section, sections_viewed, checkpoint_entry } = req.body;
  try {
    const existing = await db.getLearnerSession(req.params.id);
    if (!existing || !sameLearner(existing.learner_id, req.user && req.user.email)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = await db.updateLearnerSession(req.params.id, {
      lastSection: last_section,
      maxSection: Number.isInteger(max_section) && max_section >= 0 ? max_section : undefined,
      sectionsViewed: sections_viewed,
      checkpointEntry: checkpoint_entry,
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    console.error('session update error:', err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

module.exports = router;
