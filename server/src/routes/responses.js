const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');

/**
 * POST /api/responses
 * Record a question response for silent progress tracking.
 * Body: { user, questionId, sessionType, courseId, chapterId, correct }
 */
router.post('/', async (req, res) => {
  const { user, questionId, sessionType, courseId, chapterId, correct } = req.body;
  if (!user || !questionId || !sessionType || correct === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    await pool.query(
      `INSERT INTO question_responses
         (user_email, question_id, session_type, course_id, chapter_id, correct)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user, questionId, sessionType, courseId || null, chapterId || null, !!correct]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving question response:', err);
    res.status(500).json({ error: 'Failed to save response' });
  }
});

/**
 * GET /api/responses/chapter-weights/:user/:courseId
 * Returns per-chapter accuracy for a user/course — used by adaptive exam.
 * { chapterId: scoreFloat (0-1) }
 */
router.get('/chapter-weights/:user/:courseId', async (req, res) => {
  const { user, courseId } = req.params;
  try {
    const result = await pool.query(
      `SELECT chapter_id,
              ROUND(AVG(correct::int)::numeric, 4) AS accuracy,
              COUNT(*)                              AS total
       FROM question_responses
       WHERE user_email = $1
         AND course_id  = $2
         AND chapter_id IS NOT NULL
       GROUP BY chapter_id`,
      [user, courseId]
    );
    const weights = {};
    result.rows.forEach(r => {
      weights[r.chapter_id] = {
        accuracy: parseFloat(r.accuracy),
        total:    parseInt(r.total, 10),
      };
    });
    res.json(weights);
  } catch (err) {
    console.error('Error fetching chapter weights:', err);
    res.status(500).json({ error: 'Failed to fetch chapter weights' });
  }
});

module.exports = router;
