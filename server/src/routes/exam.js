const express = require('express');
const router = express.Router();
const axios = require('axios');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');

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

// GET /api/exam/:courseId/last-results
// Returns cached debrief from the most recent completed exam (or {available:false}).
//
// Was IDOR (backlog #88): took `user` as an arbitrary query-string email with
// no ownership check, so `?user=<any address>` returned that person's exam
// results to anyone who knew it. Only consumer is
// client-v2/src/components/PracticeExamLobby.jsx, and only when
// leadMagnetMode is false — i.e. only inside the authenticated platform,
// never the free practice exam — so gating this route the same way as
// /api/lesson (requireAuth + requireActiveSubscription) does not touch the
// free surfaces (/api/practice-exam, /api/preview, /api/diagnostic,
// GET /api/exam/:courseId/chapters). Identity now comes from the session
// (req.user.email) only. A caller that still sends ?user=<other address> has
// that value silently ignored rather than honoured or specially rejected —
// the route was never meant to answer "whose results", only "my results",
// so there is no meaningful distinction between "ignore" and "reject" from
// the caller's perspective once the value can no longer change the answer;
// ignoring avoids adding a second error path for a parameter that is now
// inert. The client also no longer sends it (see PracticeExamLobby.jsx).
router.get('/:courseId/last-results', requireAuth, requireActiveSubscription, async (req, res) => {
  const { courseId } = req.params;
  const user = req.user.email;
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
