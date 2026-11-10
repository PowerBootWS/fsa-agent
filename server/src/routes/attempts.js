// Practice exam / chapter quiz attempt history (plan
// docs/superpowers/plans/2026-11-08-practice-attempt-history.md, Phase B).
// Mounted at /api/attempts behind requireAuth + requireActiveSubscription.
//
// - Identity is req.user.email only; ?user= is never read (backlog #88).
// - Someone else's attempt, a missing one, an unfinished one, or one on a paper
//   the student is no longer entitled to are all the same 404: no existence leak.
// - Review content comes from question_responses.question_snapshot (the
//   question as it was shown). It never falls back to the live questions row,
//   which #138 cutovers rewrite in place.
const express = require('express');
const { pool } = require('../services/database');
const { requirePaperEntitlement, entitledPapers } = require('../middleware/requirePaperEntitlement');

const router = express.Router();

const KINDS = new Set(['practice_exam', 'chapter_quiz', 'retry_wrong']);
const MAX_LIMIT = 200;

// chapter_id is '{COURSE}-{N}'; chapters is keyed (course_id, chapter_num).
const ATTEMPT_COLUMNS = `
  a.id, a.course_id, a.chapter_id, c.title AS chapter_title, a.kind,
  a.started_at, a.finished_at, a.score, a.question_count, a.score_pct, a.source,
  EXISTS (SELECT 1 FROM question_responses r
           WHERE r.attempt_id = a.id AND r.question_snapshot IS NOT NULL) AS review_available`;
const CHAPTER_JOIN = `
  LEFT JOIN chapters c
    ON c.course_id = a.course_id
   AND a.chapter_id ~ '-[0-9]+$'
   AND c.chapter_num = substring(a.chapter_id from '-([0-9]+)$')::int`;

function intParam(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return max === undefined ? n : Math.min(n, max);
}

router.get('/', requirePaperEntitlement(req => req.query.course), async (req, res) => {
  const { course, kind } = req.query;
  if (kind !== undefined && !KINDS.has(kind)) {
    return res.status(400).json({ error: 'Unknown kind' });
  }
  const limit = Math.max(1, intParam(req.query.limit, 50, MAX_LIMIT));
  const offset = intParam(req.query.offset, 0);
  try {
    const papers = [...await entitledPapers(req.user.id)];
    const params = [req.user.email, papers];
    let where = 'a.user_email = $1 AND a.course_id = ANY($2) AND a.finished_at IS NOT NULL';
    if (course) { params.push(String(course).toUpperCase()); where += ` AND a.course_id = $${params.length}`; }
    if (kind) { params.push(kind); where += ` AND a.kind = $${params.length}`; }
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM assessment_attempts a ${CHAPTER_JOIN}
        WHERE ${where}
        ORDER BY a.started_at DESC, a.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ attempts: rows });
  } catch (err) {
    console.error('attempts list failed:', err.message);
    res.status(500).json({ error: 'Could not load your attempts' });
  }
});

router.get('/:id', async (req, res) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  try {
    const papers = [...await entitledPapers(req.user.id)];
    const { rows } = await pool.query(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM assessment_attempts a ${CHAPTER_JOIN}
        WHERE a.id = $1 AND a.user_email = $2 AND a.course_id = ANY($3)
          AND a.finished_at IS NOT NULL`,
      [req.params.id, req.user.email, papers]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const attempt = rows[0];

    let questions = [];
    if (attempt.review_available) {
      const { rows: answers } = await pool.query(
        `SELECT question_snapshot AS s, selected_index, correct
           FROM question_responses
          WHERE attempt_id = $1 AND question_snapshot IS NOT NULL
          ORDER BY position, id`,
        [attempt.id]
      );
      questions = answers.map(a => ({
        question_text: a.s.question_text || '',
        options: a.s.options || [],
        correct_index: a.s.correct_index,
        selected_index: a.selected_index,
        correct: a.correct,
        explanation: a.s.explanation || '',
      }));
    }
    const { review_available, ...header } = attempt;
    res.json({ attempt: header, review_available, questions });
  } catch (err) {
    console.error('attempt detail failed:', err.message);
    res.status(500).json({ error: 'Could not load this attempt' });
  }
});

module.exports = router;
