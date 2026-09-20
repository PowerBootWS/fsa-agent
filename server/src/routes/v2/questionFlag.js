// fsa-agent/server/src/routes/v2/questionFlag.js
//
// Lets a student say "this question is wrong".
//
// Added 2026-09-19. Until now there was no such path: a student who met a
// mis-keyed question could either accept that they were wrong or track Russ
// down on Facebook. One did, which is the only reason we found that 20 of
// chapter 2B3-2's 30 questions were mis-keyed. The rest of the cohort had been
// silently absorbing the same wrong answers, and the more diligent the
// student, the more damage a wrong key does to their confidence.
//
// Deliberately low friction: the reason field is optional. Asking someone to
// justify a report in writing is enough friction to stop most people filing it,
// and we would rather have a noisy signal than no signal.
const express = require('express');
const router = express.Router();
const { pool } = require('../../services/database');
const { telegram } = require('fsa-common');

// POST /api/v2/question-flag
// Body: { question_id, lesson_code?, selected_index?, reason? }
router.post('/', async (req, res) => {
  const { question_id, lesson_code, selected_index, reason } = req.body;
  const email = req.user?.email;

  if (!question_id) return res.status(400).json({ error: 'question_id required' });
  if (!email) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Snapshot what the key said at flag time. The key may well be corrected
    // before anyone reads the flag, and without this the report reads as a
    // complaint about a question that now looks fine.
    const q = await pool.query(
      'SELECT correct_answer, options FROM questions WHERE id = $1',
      [question_id]
    );
    if (q.rowCount === 0) return res.status(404).json({ error: 'Question not found' });

    await pool.query(
      `INSERT INTO question_flags
         (question_id, user_email, lesson_code, reason, selected_index, keyed_index)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (question_id, user_email) WHERE status = 'open'
       DO UPDATE SET reason = COALESCE(EXCLUDED.reason, question_flags.reason),
                     created_at = CURRENT_TIMESTAMP`,
      [
        question_id,
        email,
        lesson_code || null,
        (reason || '').trim() || null,
        Number.isInteger(selected_index) ? selected_index : null,
        q.rows[0].correct_answer,
      ]
    );

    res.json({ ok: true });

    // Tell Russ now, not at the next dashboard run. A flag means a paying
    // student is currently looking at something they believe is wrong, and the
    // whole point of this feature is that the last one had to use Facebook.
    //
    // Nothing is awaited past the response: an await here that rejected would
    // reach the catch below and try to send a second set of headers on a
    // request already answered.
    const opts = q.rows[0].options || [];
    const picked = Number.isInteger(selected_index) ? opts[selected_index] : null;
    telegram.notifyOwner(
      `⚠️ Question flagged by a student\n\n` +
      `Question ${question_id}${lesson_code ? ` (${lesson_code})` : ''}\n` +
      `Student: ${email}\n` +
      `They picked: ${picked || '(not recorded)'}\n` +
      `Key says: ${opts[q.rows[0].correct_answer] || '(unknown)'}\n` +
      (reason ? `\nThey said: ${String(reason).trim().slice(0, 500)}` : '')
    ).catch(err => console.error('question flag notify failed (non-fatal):', err.message));
  } catch (err) {
    console.error('question flag error:', err.message);
    res.status(500).json({ error: 'Failed to record flag' });
  }
});

module.exports = router;
