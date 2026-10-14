const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../services/database');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

// The checkpoint card in the student's chat panel, reported by the lesson
// player so the tutor knows which question they are looking at. Shape-checked
// and capped here; anything malformed is dropped rather than forwarded.
function cleanScreenQuestion(q) {
  if (!q || typeof q !== 'object' || typeof q.question_text !== 'string' || !q.question_text.trim()) {
    return undefined;
  }
  const options = Array.isArray(q.options)
    ? q.options.filter(o => typeof o === 'string').slice(0, 6).map(o => o.slice(0, 500))
    : [];
  const index = v => (Number.isInteger(v) && v >= 0 && v < options.length ? v : null);
  return {
    question_text: q.question_text.slice(0, 2000),
    options,
    selected_index: index(q.selected_index),
    correct_answer: index(q.correct_answer),
  };
}

// Send message to Tutor Agent
router.post('/', async (req, res) => {
  try {
    const { lessonId, message, examConfig, slideNumber, screenQuestion } = req.body;
    // The session owner, never the body: the tutor now reads saved transcripts
    // and a cross-objective memory keyed on this, so a client-chosen `user`
    // would let one student read another's conversations.
    const user = req.user && req.user.email;

    if (!user || !lessonId || !message) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Forward to Python AI service — include examConfig when present
    const payload = { user, lessonId, message };
    if (examConfig) payload.examConfig = examConfig;
    if (Number.isInteger(slideNumber) && slideNumber >= 0) payload.slideNumber = slideNumber;
    const sq = cleanScreenQuestion(screenQuestion);
    if (sq) payload.screenQuestion = sq;

    const response = await axios.post(`${PYTHON_SERVICE_URL}/agent/chat`, payload);

    res.json(response.data);
  } catch (error) {
    console.error('Error in chat:', error.message);
    res.status(500).json({ error: 'Failed to get response from tutor' });
  }
});

// GET /api/chat/history/:lessonCode — the session owner's saved conversation
// for one objective, so the tutor drawer reopens on the same conversation.
router.get('/history/:lessonCode', async (req, res) => {
  const email = req.user && req.user.email;
  if (!email) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const messages = await db.getChatTranscript(email, req.params.lessonCode);
    res.json({ messages });
  } catch (err) {
    console.error('chat history error:', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

router.cleanScreenQuestion = cleanScreenQuestion;
module.exports = router;
