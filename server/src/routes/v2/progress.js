// server/src/routes/v2/progress.js
const express = require('express');
const router = express.Router();
const db = require('../../services/database');
const { requirePaperEntitlement } = require('../../middleware/requirePaperEntitlement');

// The learner is always the signed-in student. The :learnerId path segment is kept
// so existing clients keep working, but it is ignored: it used to let any
// subscriber read or overwrite another student's resume position. Audit 2026-10-21.
const me = req => (req.user && req.user.email) || '';

// GET /api/v2/progress/:learnerId/:courseId
router.get('/:learnerId/:courseId', requirePaperEntitlement(req => req.params.courseId), async (req, res) => {
  try {
    const progress = await db.getCourseProgress(
      me(req),
      req.params.courseId
    );
    if (!progress) {
      return res.json({
        learner_id: me(req),
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
router.patch('/:learnerId/:courseId', requirePaperEntitlement(req => req.params.courseId), async (req, res) => {
  const { last_lesson_code, last_slide } = req.body;
  if (!last_lesson_code || !last_slide) {
    return res.status(400).json({ error: 'last_lesson_code and last_slide required' });
  }
  try {
    const progress = await db.upsertCourseProgress(
      me(req),
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
