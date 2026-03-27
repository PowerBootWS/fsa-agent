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

  // Validate lessonId format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(lessonId)) {
    return res.status(400).json({ error: 'Invalid lessonId format' });
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