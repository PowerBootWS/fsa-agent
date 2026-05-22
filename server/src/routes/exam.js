const express = require('express');
const router = express.Router();
const axios = require('axios');
const { pool } = require('../services/database');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

// GET /api/exam/:courseId/chapters
// Returns sorted list of chapter IDs that have questions for this course.
router.get('/:courseId/chapters', async (req, res) => {
  try {
    const { courseId } = req.params;
    const result = await pool.query(
      `SELECT DISTINCT chapter_id
       FROM questions
       WHERE course_id = $1
         AND chapter_id IS NOT NULL
         AND options IS NOT NULL
         AND jsonb_array_length(options) > 0
       ORDER BY chapter_id`,
      [courseId]
    );
    res.json({ chapters: result.rows.map(r => r.chapter_id) });
  } catch (error) {
    console.error('Error fetching chapters:', error.message);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// GET /api/exam/:courseId/last-results?user=...
// Returns cached debrief from the most recent completed exam (or {available:false}).
router.get('/:courseId/last-results', async (req, res) => {
  const { courseId } = req.params;
  const { user } = req.query;
  if (!user) {
    return res.status(400).json({ error: 'Missing user parameter' });
  }
  try {
    const response = await axios.get(
      `${PYTHON_SERVICE_URL}/agent/exam/${encodeURIComponent(courseId)}/last-results`,
      { params: { user } }
    );
    res.json(response.data);
  } catch (error) {
    // If Python service is unavailable, just report no results
    res.json({ available: false });
  }
});

module.exports = router;
