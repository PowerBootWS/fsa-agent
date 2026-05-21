const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');

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

module.exports = router;
