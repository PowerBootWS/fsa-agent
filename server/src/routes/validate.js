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

  // Validate lessonId format: lesson_code (e.g. '2A1-1-1'), UUID, or integer
  const lessonCodeRegex = /^[A-Z0-9]{2,5}-\d{1,3}-\d{1,3}$/i;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const intRegex = /^[0-9]+$/;
  if (!lessonCodeRegex.test(lessonId) && !uuidRegex.test(lessonId) && !intRegex.test(lessonId)) {
    return res.status(400).json({ error: 'Invalid lessonId format. Expected format: 2A1-1-1 (course-chapter-objective)' });
  }

  // Create session context (in production, use proper session management)
  const session = {
    user,
    lessonId,
    validatedAt: new Date().toISOString(),
  };

  res.json({ success: true, session });
});

module.exports = router;