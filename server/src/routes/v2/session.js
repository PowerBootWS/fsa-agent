// fsa-agent/server/src/routes/v2/session.js
const express = require('express');
const router = express.Router();
const db = require('../../services/database');

// POST /api/v2/session — create or resume a session
// Body: { learner_id, lesson_code }
router.post('/', async (req, res) => {
  const { learner_id, lesson_code } = req.body;
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
// Body: { last_section?, sections_viewed?, checkpoint_entry? }
router.patch('/:id', async (req, res) => {
  const { last_section, sections_viewed, checkpoint_entry } = req.body;
  try {
    const session = await db.updateLearnerSession(req.params.id, {
      lastSection: last_section,
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
