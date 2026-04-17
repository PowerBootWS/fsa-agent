const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Save chat history for a session
router.post('/', async (req, res) => {
  try {
    const { user, lessonId, messages } = req.body;

    if (!user || !lessonId || !messages) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await db.saveChatHistory(user, lessonId, messages);
    res.json(result);
  } catch (error) {
    console.error('Error saving chat history:', error);
    res.status(500).json({ error: 'Failed to save chat history' });
  }
});

module.exports = router;
