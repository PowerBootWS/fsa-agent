const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');

// Backlog #121 (2026-09-16) — every GoHighLevel contact write is gone from this
// service. Two routes lived here and both were GHL-only:
//
//   POST /api/preview/signup       upserted the user then created a GHL contact
//                                  tagged practice-preview / opted-in
//   POST /api/preview/send-results upserted a GHL contact to resolve its id and
//                                  sent the results email through GHL
//                                  /conversations/messages
//
// Both belonged to the old client/ (v1) practice-preview lead magnet, retired
// 2026-07-27 and superseded by the verification-gated /free-practice-exam flow
// (server/src/routes/practiceExam.js). Their only callers were in client/,
// which is dead code, and /api returns 421 on the legacy host anyway. Deleted
// outright rather than rewritten: FSA no longer sends mail through GHL (all
// outbound is the Gmail API via fsa-common) and no known contact is written to
// GHL any more.
//
// GET /papers stays: it is NOT a GHL route, and it is live. The current
// front end calls it on every free-practice-exam paper picker render —
// client-v2/src/pages/FreePracticeExamPage.jsx fetchPapersForClass(), and the
// string is present in the compiled client-v2/build bundle. Deleting it would
// have broken the paper picker in production.

// GET /api/preview/papers?class=second|third
// Returns the papers for the given class that actually have questions, so the
// paper picker only offers practiceable papers. For third class this means
// 3A1/3A2 until 3B1/3B2 are authored, then they appear automatically.
const PAPERS_SECOND = ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3'];
const PAPERS_THIRD = ['3A1', '3A2', '3B1', '3B2'];
router.get('/papers', async (req, res) => {
  const classPapers = req.query.class === 'third' ? PAPERS_THIRD : PAPERS_SECOND;
  try {
    const avail = await pool.query(
      `SELECT DISTINCT course_id FROM questions WHERE course_id = ANY($1::text[])`,
      [classPapers]
    );
    const set = new Set(avail.rows.map(r => r.course_id));
    res.json({ papers: classPapers.filter(p => set.has(p)) });
  } catch (err) {
    console.error('preview/papers error:', err.message);
    res.status(500).json({ error: 'Failed to load papers' });
  }
});

module.exports = router;
module.exports.PAPERS_SECOND = PAPERS_SECOND;
module.exports.PAPERS_THIRD = PAPERS_THIRD;
