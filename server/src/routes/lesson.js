const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Get lesson data by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const lesson = await db.getLesson(id);

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    res.json(lesson);
  } catch (error) {
    console.error('Error fetching lesson:', error);
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

module.exports = router;