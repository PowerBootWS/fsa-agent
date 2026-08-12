const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Get user progress for a lesson.
// The subject is always the authenticated session owner — a client-supplied
// `?user=` is ignored, otherwise any logged-in student could read (and, on
// POST, overwrite) every other student's progress by naming their email.
router.get('/:lessonId', async (req, res) => {
  try {
    const { lessonId } = req.params;
    const user = req.user?.email;

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
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
    const { lessonId, score, struggles, attempts, complexityLevel, completed, outcome, sessionNotes } = req.body;
    const user = req.user?.email;

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!lessonId) {
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