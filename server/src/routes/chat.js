const express = require('express');
const router = express.Router();
const axios = require('axios');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

// Send message to Tutor Agent
router.post('/', async (req, res) => {
  try {
    const { user, lessonId, message } = req.body;

    if (!user || !lessonId || !message) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Forward to Python AI service
    const response = await axios.post(`${PYTHON_SERVICE_URL}/agent/chat`, {
      user,
      lessonId,
      message,
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error in chat:', error.message);
    res.status(500).json({ error: 'Failed to get response from tutor' });
  }
});

module.exports = router;