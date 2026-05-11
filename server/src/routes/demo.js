const express = require('express');
const router = express.Router();
const axios = require('axios');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

// Seed orchestrator state for demo exam debrief.
// POST /api/demo/exam-debrief  { user, lessonId }
router.post('/exam-debrief', async (req, res) => {
  try {
    const { user, lessonId } = req.body;
    if (!user || !lessonId) {
      return res.status(400).json({ error: 'Missing user or lessonId' });
    }
    const response = await axios.post(`${PYTHON_SERVICE_URL}/agent/demo/exam-debrief`, {
      user,
      lessonId,
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error seeding demo exam:', error.message);
    res.status(500).json({ error: 'Failed to seed demo exam state' });
  }
});

module.exports = router;
