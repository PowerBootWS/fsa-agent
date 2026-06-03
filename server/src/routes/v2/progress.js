// server/src/routes/v2/progress.js
const express = require('express');
const router = express.Router();
const db = require('../../services/database');

// GET /api/v2/progress/:learnerId/:courseId
router.get('/:learnerId/:courseId', async (req, res) => {
  try {
    const progress = await db.getCourseProgress(
      req.params.learnerId,
      req.params.courseId
    );
    if (!progress) {
      return res.json({
        learner_id: req.params.learnerId,
        course_id: req.params.courseId,
        last_lesson_code: null,
        last_slide: null,
      });
    }
    res.json(progress);
  } catch (err) {
    console.error('progress get error:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// PATCH /api/v2/progress/:learnerId/:courseId
// Body: { last_lesson_code, last_slide }
router.patch('/:learnerId/:courseId', async (req, res) => {
  const { last_lesson_code, last_slide } = req.body;
  if (!last_lesson_code || !last_slide) {
    return res.status(400).json({ error: 'last_lesson_code and last_slide required' });
  }
  try {
    const progress = await db.upsertCourseProgress(
      req.params.learnerId,
      req.params.courseId,
      last_lesson_code,
      parseInt(last_slide, 10)
    );
    res.json(progress);
  } catch (err) {
    console.error('progress update error:', err);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

module.exports = router;
