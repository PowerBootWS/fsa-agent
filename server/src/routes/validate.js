const express = require('express');
const router = express.Router();

// Validate iframe query params and establish session
router.post('/', (req, res) => {
  const { user, lessonId } = req.body;

  if (!user || !lessonId) {
    return res.status(400).json({ error: 'Missing required parameters: user, lessonId' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(user)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Detect mode from lessonId format:
  //   2B1-1-3  → lesson        (paper-chapter-objective, 3 segments)
  //   2B1-1    → chapter_quiz  (paper-chapter, 2 segments)
  //   2B1      → practice_exam (paper only, 1 segment)
  //   integer  → lesson (numeric DB id, legacy)
  //   UUID     → lesson (legacy)
  const lessonRegex   = /^[A-Z0-9]{2,5}-\d{1,3}-\d{1,3}$/i;
  const chapterRegex  = /^[A-Z0-9]{2,5}-\d{1,3}$/i;
  const examRegex     = /^[A-Z0-9]{2,5}$/i;
  const uuidRegex     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const intRegex      = /^[0-9]+$/;

  let mode;
  if (lessonRegex.test(lessonId) || uuidRegex.test(lessonId) || intRegex.test(lessonId)) {
    mode = 'lesson';
  } else if (chapterRegex.test(lessonId)) {
    mode = 'chapter_quiz';
  } else if (examRegex.test(lessonId)) {
    mode = 'practice_exam';
  } else {
    return res.status(400).json({ error: 'Invalid lessonId format. Expected 2B1-1-3 (lesson), 2B1-1 (chapter quiz), or 2B1 (practice exam).' });
  }

  const session = {
    user,
    lessonId,
    mode,
    validatedAt: new Date().toISOString(),
  };

  res.json({ success: true, session, mode });
});

module.exports = router;