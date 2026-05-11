const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');

const PAPERS = ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3'];

/**
 * GET /api/diagnostic/questions?count=30
 * Returns a sampled set of questions for the diagnostic quiz.
 * count must be 30 or 60; questions-per-paper = count / 6 (5 or 10).
 * Returns correct_answer so the client can show per-question feedback.
 * Score integrity is enforced server-side in POST /api/diagnostic/results.
 */
router.get('/questions', async (req, res) => {
  const count = parseInt(req.query.count, 10);
  if (count !== 30 && count !== 60) {
    return res.status(400).json({ error: 'count must be 30 or 60' });
  }
  const perPaper = count / 6; // 5 or 10

  try {
    const paperResults = await Promise.all(PAPERS.map(async (paper) => {
      // Primary: difficulty 3-4
      const primary = await pool.query(
        `SELECT id, question_text, options, correct_answer, course_id, chapter_id
         FROM questions
         WHERE course_id = $1
           AND difficulty BETWEEN 3 AND 4
           AND question_type IN ('objective_practice', 'chapter_quiz')
           AND standalone = TRUE
         ORDER BY RANDOM()
         LIMIT $2`,
        [paper, perPaper]
      );
      let rows = primary.rows;

      // Fallback: any difficulty, excluding already-selected IDs
      if (rows.length < perPaper) {
        const needed = perPaper - rows.length;
        const excludeIds = rows.map(r => r.id);
        const fallback = await pool.query(
          `SELECT id, question_text, options, correct_answer, course_id, chapter_id
           FROM questions
           WHERE course_id = $1
             AND question_type IN ('objective_practice', 'chapter_quiz')
             AND standalone = TRUE
             AND id != ALL($2::int[])
           ORDER BY RANDOM()
           LIMIT $3`,
          [paper, excludeIds.length ? excludeIds : [0], needed]
        );
        rows = [...rows, ...fallback.rows];
      }

      return rows;
    }));

    res.json(paperResults.flat());
  } catch (err) {
    console.error('Error fetching diagnostic questions:', err);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

/**
 * POST /api/diagnostic/results
 * Accepts student responses, recomputes scores server-side, persists to
 * question_responses, and returns per-paper scores + attack order.
 *
 * Body: { user_email: string, responses: [{ question_id, selected_index }] }
 */
router.post('/results', async (req, res) => {
  const { user_email, responses } = req.body;

  if (!user_email || !Array.isArray(responses) || responses.length === 0) {
    return res.status(400).json({ error: 'Missing user_email or responses' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(user_email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Fetch all submitted questions in one query
    const questionIds = responses.map(r => r.question_id);
    const qResult = await pool.query(
      `SELECT id, correct_answer, course_id, chapter_id
       FROM questions
       WHERE id = ANY($1::int[])`,
      [questionIds]
    );

    const questionMap = {};
    qResult.rows.forEach(q => { questionMap[q.id] = q; });

    // Enrich responses with server-side correctness
    const enriched = responses.map(r => {
      const q = questionMap[r.question_id];
      if (!q) return null;
      return {
        question_id: r.question_id,
        selected_index: r.selected_index,
        correct: r.selected_index === q.correct_answer,
        course_id: q.course_id,
        chapter_id: q.chapter_id,
      };
    }).filter(Boolean);

    // Batch-insert into question_responses
    if (enriched.length > 0) {
      const values = enriched.map((r, i) => {
        const base = i * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      }).join(', ');

      const params = enriched.flatMap(r => [
        user_email,
        r.question_id,
        'diagnostic',
        r.course_id || null,
        r.chapter_id || null,
        r.correct,
      ]);

      await pool.query(
        `INSERT INTO question_responses
           (user_email, question_id, session_type, course_id, chapter_id, correct)
         VALUES ${values}`,
        params
      );
    }

    // Compute per-paper stats
    const paperStats = PAPERS.map(paper => {
      const paperResponses = enriched.filter(r => r.course_id === paper);
      const total = paperResponses.length;
      const correct = paperResponses.filter(r => r.correct).length;
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
      return { course_id: paper, correct, total, pct };
    });

    // Attack order: confident (>=40%) sorted high→low, foundation (<40%) sorted low→high
    const confident = paperStats
      .filter(p => p.pct >= 40)
      .sort((a, b) => b.pct - a.pct);
    const foundation = paperStats
      .filter(p => p.pct < 40)
      .sort((a, b) => a.pct - b.pct);

    const attackOrder = [...confident, ...foundation].map((p, i) => ({
      course_id: p.course_id,
      pct: p.pct,
      rank: i + 1,
      flag: p.pct < 40 ? 'needs_foundation' : null,
    }));

    const totalCorrect = enriched.filter(r => r.correct).length;

    res.json({
      paper_scores: paperStats,
      attack_order: attackOrder,
      total_correct: totalCorrect,
      total_questions: enriched.length,
    });
  } catch (err) {
    console.error('Error processing diagnostic results:', err);
    res.status(500).json({ error: 'Failed to process results' });
  }
});

module.exports = router;
