// server/src/routes/v2/course.js
const express = require('express');
const router = express.Router();
const db = require('../../services/database');

// GET /api/v2/course/:courseId/outline
router.get('/:courseId/outline', async (req, res) => {
  try {
    const outline = await db.getCourseOutline(req.params.courseId);
    if (!outline.chapters.length) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(outline);
  } catch (err) {
    console.error('course outline error:', err);
    res.status(500).json({ error: 'Failed to fetch course outline' });
  }
});

module.exports = router;
