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

async function getLastExam(pool, email, paper) {
  const { rows } = await pool.query(
    `SELECT
       qr.chapter_id,
       COUNT(*) as total,
       SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) as correct,
       DATE_TRUNC('minute', MAX(qr.answered_at)) as exam_date
     FROM question_responses qr
     WHERE qr.user_email = $1 AND qr.course_id = $2 AND qr.session_type = 'practice_exam'
       AND qr.answered_at = (
         SELECT MAX(answered_at) FROM question_responses
         WHERE user_email = $1 AND course_id = $2 AND session_type = 'practice_exam'
       )
     GROUP BY qr.chapter_id`,
    [email, paper]
  );
  if (rows.length === 0) return null;
  const totalCorrect = rows.reduce((sum, r) => sum + parseInt(r.correct), 0);
  const totalQs = rows.reduce((sum, r) => sum + parseInt(r.total), 0);
  return {
    score: Math.round((totalCorrect / totalQs) * 100),
    date: rows[0].exam_date,
    chapters: rows.map(r => ({
      chapter_id: r.chapter_id,
      score: Math.round((parseInt(r.correct) / parseInt(r.total)) * 100),
    })),
  };
}

module.exports = { getObjectiveProgress, getLastExam };
