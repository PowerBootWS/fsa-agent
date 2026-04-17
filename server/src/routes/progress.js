const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Get user progress for a lesson
router.get('/:lessonId', async (req, res) => {
  try {
    const { lessonId } = req.params;
    const { user } = req.query;

    if (!user) {
      return res.status(400).json({ error: 'Missing user parameter' });
    }

    const progress = await db.getUserProgress(user, lessonId);

    if (!progress) {
      return res.json(null);
    }

    res.json(progress);
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Update user progress
router.post('/', async (req, res) => {
  try {
    const { user, lessonId, score, struggles, attempts, complexityLevel, completed, outcome, sessionNotes } = req.body;

    if (!user || !lessonId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const progress = await db.updateUserProgress({
      user,
      lessonId,
      score,
      struggles,
      attempts,
      complexityLevel,
      completed,
      outcome,
      sessionNotes,
    });

    res.json(progress);
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

module.exports = router;