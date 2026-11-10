// Per-paper progress figures shared by the course lobby (/lobby-data), the
// 4th Class quiz lobby (/quiz-lobby-data) and the Home page (/home). Extracted
// so the three cannot drift apart on what "last practice exam" means.

async function getObjectiveProgress(pool, email, paper) {
  const totalResult = await pool.query(
    `SELECT COUNT(*) FROM lessons WHERE lesson_code LIKE $1`,
    [`${paper}-%`]
  );
  const completedResult = await pool.query(
    `SELECT COUNT(*) FROM user_progress
     WHERE user_email = $1 AND lesson_code LIKE $2 AND completed = true`,
    [email, `${paper}-%`]
  );
  const total = parseInt(totalResult.rows[0].count);
  const completed = parseInt(completedResult.rows[0].count);
  return { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

// The latest FINISHED practice exam sitting, from assessment_attempts
// (attempt history, 2026-11-10). This used to take the question_responses
// rows at MAX(answered_at), but every answer has its own timestamp, so that
// matched exactly one answer and the score was always 0% or 100%
// (Correction 3 in docs/superpowers/plans/2026-11-08-practice-attempt-history.md).
// Exams taken before attempt history existed have no attempt row (apart from
// the backfilled latest debrief), so they show nothing rather than a wrong number.
async function getLastExam(pool, email, paper) {
  const { rows } = await pool.query(
    `SELECT score_pct, finished_at, chapter_stats
       FROM assessment_attempts
      WHERE user_email = $1 AND course_id = $2 AND kind = 'practice_exam'
        AND finished_at IS NOT NULL
      ORDER BY finished_at DESC, id DESC
      LIMIT 1`,
    [email, paper]
  );
  if (rows.length === 0) return null;
  const a = rows[0];
  const stats = a.chapter_stats || {};
  return {
    score: a.score_pct,
    date: a.finished_at,
    chapters: Object.entries(stats)
      .filter(([, s]) => s && s.total > 0)
      .map(([chapterId, s]) => ({
        chapter_id: chapterId === 'Unknown' ? null : chapterId,
        score: Math.round((s.correct / s.total) * 100),
      })),
  };
}

// Per-chapter totals over the student's last `n` finished practice exams on
// one paper, weakest first (attempt history Phase D; Russ chose "last 3").
async function getWeakChapters(pool, email, paper, n = 3) {
  const { rows } = await pool.query(
    `SELECT chapter_stats FROM assessment_attempts
      WHERE user_email = $1 AND course_id = $2 AND kind = 'practice_exam'
        AND finished_at IS NOT NULL AND chapter_stats IS NOT NULL
      ORDER BY finished_at DESC, id DESC
      LIMIT $3`,
    [email, paper, n]
  );
  const totals = {};
  for (const { chapter_stats: stats } of rows) {
    for (const [chapterId, s] of Object.entries(stats || {})) {
      if (!/-\d+$/.test(chapterId) || !s || !(s.total > 0)) continue;
      totals[chapterId] = totals[chapterId] || { correct: 0, total: 0 };
      totals[chapterId].correct += s.correct;
      totals[chapterId].total += s.total;
    }
  }
  const ids = Object.keys(totals);
  const titles = {};
  if (ids.length) {
    const { rows: ch } = await pool.query(
      `SELECT chapter_num, title FROM chapters WHERE course_id = $1 AND chapter_num = ANY($2::int[])`,
      [paper, ids.map(id => parseInt(id.split('-').pop(), 10))]
    );
    for (const r of ch) titles[r.chapter_num] = r.title;
  }
  const chapters = ids
    .map(id => ({
      chapter_id: id,
      title: titles[parseInt(id.split('-').pop(), 10)] || null,
      correct: totals[id].correct,
      total: totals[id].total,
      pct: Math.round((totals[id].correct / totals[id].total) * 100),
    }))
    .sort((a, b) => a.pct - b.pct || b.total - a.total);
  return { exams: rows.length, chapters };
}

module.exports = { getObjectiveProgress, getLastExam, getWeakChapters };
