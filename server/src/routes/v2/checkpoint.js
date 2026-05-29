// fsa-agent/server/src/routes/v2/checkpoint.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../../services/database');

const AI_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://ai-service:5000';

// POST /api/v2/checkpoint
// Body: { session_id, lesson_code, sections_covered: [{title, body}] }
router.post('/', async (req, res) => {
  const { session_id, lesson_code, sections_covered } = req.body;
  if (!session_id || !lesson_code || !sections_covered?.length) {
    return res.status(400).json({ error: 'session_id, lesson_code, sections_covered required' });
  }

  try {
    // Load session history
    const session = await db.getLearnerSession(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const log = session.checkpoint_log || [];
    const recentLog = log.slice(-10);
    const correct = recentLog.filter(e => e.correct).length;
    const correctPct = recentLog.length > 0 ? correct / recentLog.length : 0;

    // Pick a question (exclude already-asked question ids)
    const askedIds = log.map(e => e.question_id).filter(Boolean);
    const question = await db.getCheckpointQuestion(lesson_code, askedIds);

    // Get check-in message from AI service
    const aiRes = await axios.post(`${AI_SERVICE_URL}/checkpoint`, {
      sections_covered,
      correct_pct: correctPct,
      question_count: log.length,
    });

    res.json({
      message: aiRes.data.message,
      question: question || null,
      performance: { correct_pct: correctPct, question_count: log.length },
    });
  } catch (err) {
    console.error('checkpoint error:', err.message);
    res.status(500).json({ error: 'Checkpoint failed' });
  }
});

module.exports = router;
