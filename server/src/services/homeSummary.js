// Data for the Home page's course and jobs cards. Each function is independent
// so routes/home.js can let one fail without taking the page down.

const { PAPERS_BY_CLASS, FOURTH_CLASS_CODES } = require('../config/papersForClass');
const { getObjectiveProgress, getLastExam } = require('./paperStats');

async function weakestChapter(pool, paper, lastExam) {
  if (!lastExam || lastExam.chapters.length === 0) return null;
  const weakest = lastExam.chapters.reduce((a, b) => (b.score < a.score ? b : a));
  const chapterNum = parseInt(String(weakest.chapter_id).split('-').pop(), 10);
  const { rows } = await pool.query(
    `SELECT title FROM chapters WHERE course_id = $1 AND chapter_num = $2`,
    [paper, chapterNum]
  );
  return { chapter_id: weakest.chapter_id, title: rows[0]?.title || null, score: weakest.score };
}

async function paperSnapshot(pool, email, classCode, paper) {
  const isFourth = FOURTH_CLASS_CODES.includes(classCode);
  const progress = isFourth ? null : await getObjectiveProgress(pool, email, paper);
  const lastExam = await getLastExam(pool, email, paper);
  return {
    class_code: classCode,
    paper,
    pct_complete: progress ? progress.percent : null,
    last_exam_score: lastExam ? lastExam.score : null,
    weakest_chapter: await weakestChapter(pool, paper, lastExam),
  };
}

// "Live" uses the same condition as requireAuth: status active and cancel_at
// unset or still in the future.
async function getCourseSection(pool, userId, email) {
  const { rows } = await pool.query(
    `SELECT class_code, active_paper FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND (cancel_at IS NULL OR cancel_at > NOW())
     ORDER BY class_code`,
    [userId]
  );
  if (rows.length === 0) {
    const { rows: [hist] } = await pool.query(
      `SELECT COUNT(*) > 0 AS had FROM subscriptions WHERE user_id = $1`, [userId]);
    return { state: hist.had ? 'lapsed' : 'none', subscriptions: [] };
  }
  const subscriptions = [];
  for (const row of rows) {
    const papers = FOURTH_CLASS_CODES.includes(row.class_code)
      ? PAPERS_BY_CLASS[row.class_code]
      : (row.active_paper ? [row.active_paper] : []);
    if (papers.length === 0) {
      subscriptions.push({ class_code: row.class_code, paper: null, pct_complete: null,
        last_exam_score: null, weakest_chapter: null });
      continue;
    }
    for (const paper of papers) {
      subscriptions.push(await paperSnapshot(pool, email, row.class_code, paper));
    }
  }
  return { state: 'active', subscriptions };
}

async function getJobsSection(pool, userId) {
  const { rows: [r] } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM saved_jobs WHERE user_id = $1 AND status <> 'archived')::int AS saved_count,
       (SELECT COUNT(*) FROM generated_documents WHERE user_id = $1 AND doc_type = 'resume')::int AS custom_resumes_count`,
    [userId]
  );
  return { saved_count: r.saved_count, custom_resumes_count: r.custom_resumes_count };
}

async function hasResumeOnFile(pool, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_documents WHERE user_id = $1 AND doc_type = 'resume' LIMIT 1`, [userId]);
  return rows.length > 0;
}

module.exports = { getCourseSection, getJobsSection, hasResumeOnFile };
