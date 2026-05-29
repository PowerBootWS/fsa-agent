// fsa-agent/server/src/routes/v2/lesson.js
const express = require('express');
const router = express.Router();
const db = require('../../services/database');

// GET /api/v2/lesson/:lessonCode
router.get('/:lessonCode', async (req, res) => {
  try {
    const lesson = await db.getV2Lesson(req.params.lessonCode);
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    res.json(lesson);
  } catch (err) {
    console.error('v2 lesson error:', err);
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

module.exports = router;
