const express = require('express');
const crypto = require('crypto');
const { pool, getCourseOutline } = require('../services/database');
const { sendMagicLink } = require('../services/email');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const PAPER_SWITCH_COOLDOWN_DAYS = parseInt(process.env.PAPER_SWITCH_COOLDOWN_DAYS || '7', 10);

/**
 * Middleware: verify x-internal-secret header matches INTERNAL_SECRET env var.
 */
function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/platform/provision-user
router.post('/provision-user', requireInternalSecret, async (req, res) => {
  try {
    const { email, first_name, last_name, class_code } = req.body;

    if (!email || !first_name || !class_code) {
      return res.status(400).json({ error: 'email, first_name, and class_code are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Upsert platform_users — insert if not exists, then select
    await pool.query(
      `INSERT INTO platform_users (email, first_name, last_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [normalizedEmail, first_name, last_name || null]
    );

    const userResult = await pool.query(
      `SELECT id FROM platform_users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = userResult.rows[0];

    // Ensure active subscription exists for this user + class_code
    // For re-enrollment (returning users with inactive subscriptions), insert a new active subscription
    await pool.query(
      `INSERT INTO subscriptions (user_id, class_code, status, active_paper)
       SELECT $1, $2, 'active', NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM subscriptions
         WHERE user_id = $1 AND class_code = $2 AND status = 'active'
       )`,
      [user.id, class_code]
    );

    // Generate magic link token (48h TTL)
    const token = crypto.randomUUID();
    await pool.query(
      `INSERT INTO auth_tokens (user_id, token, type, expires_at)
       VALUES ($1, $2, 'magic_link', now() + interval '48 hours')`,
      [user.id, token]
    );

    await sendMagicLink(normalizedEmail, first_name, token);

    return res.json({ ok: true, user_id: user.id });
  } catch (err) {
    console.error('POST /api/platform/provision-user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/platform/deactivate-user
router.post('/deactivate-user', requireInternalSecret, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const userResult = await pool.query(
      `SELECT id FROM platform_users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query(
      `UPDATE subscriptions
       SET status = 'inactive', deactivated_at = now()
       WHERE user_id = $1 AND status = 'active'`,
      [user.id]
    );

    await pool.query(
      `UPDATE platform_users SET current_session_token = NULL WHERE id = $1`,
      [user.id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/platform/deactivate-user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/platform/switch-paper
router.post('/switch-paper', requireAuth, async (req, res) => {
  try {
    const { paper } = req.body;

    if (!paper) {
      return res.status(400).json({ error: 'paper is required' });
    }

    const { subscription_id, last_paper_switch_at } = req.user;

    if (last_paper_switch_at) {
      const switchedAt = new Date(last_paper_switch_at);
      const now = new Date();
      const diffMs = now - switchedAt;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays < PAPER_SWITCH_COOLDOWN_DAYS) {
        const daysRemaining = Math.ceil(PAPER_SWITCH_COOLDOWN_DAYS - diffDays);
        return res.status(429).json({ error: 'Paper switch cooldown', days_remaining: daysRemaining });
      }
    }

    await pool.query(
      `UPDATE subscriptions SET active_paper = $1, last_paper_switch_at = now() WHERE id = $2`,
      [paper, subscription_id]
    );

    return res.json({ ok: true, active_paper: paper });
  } catch (err) {
    console.error('POST /api/platform/switch-paper error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/papers-for-class
router.get('/papers-for-class', requireAuth, async (req, res) => {
  const { class_code } = req.user;
  const papers = class_code === 'second'
    ? ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']
    : ['3A1', '3A2', '3B1', '3B2'];
  return res.json({ papers, class_code });
});

// GET /api/platform/lobby-data
router.get('/lobby-data', requireAuth, async (req, res) => {
  try {
    const { email, active_paper } = req.user;

    if (!active_paper) {
      return res.status(400).json({ error: 'No active paper selected' });
    }

    // 1. Count total objectives for this paper
    const totalObjectivesResult = await pool.query(
      `SELECT COUNT(*) FROM lessons WHERE lesson_code LIKE $1`,
      [`${active_paper}-%`]
    );
    const totalObjectives = parseInt(totalObjectivesResult.rows[0].count);

    // 2. Count completed objectives
    const completedObjectivesResult = await pool.query(
      `SELECT COUNT(*) FROM user_progress
       WHERE user_email = $1 AND lesson_code LIKE $2 AND completed = true`,
      [email, `${active_paper}-%`]
    );
    const completedObjectives = parseInt(completedObjectivesResult.rows[0].count);

    // 3. Last visited lesson
    const lastVisitedResult = await pool.query(
      `SELECT up.lesson_code, l.title, up.last_accessed
       FROM user_progress up
       LEFT JOIN lessons l ON l.lesson_code = up.lesson_code
       WHERE up.user_email = $1 AND up.lesson_code LIKE $2
       ORDER BY up.last_accessed DESC LIMIT 1`,
      [email, `${active_paper}-%`]
    );
    const lastVisited = lastVisitedResult.rows[0] || null;

    // 4. Chapter quiz data — for each chapter, get the latest quiz score
    const chapterQuizResult = await pool.query(
      `SELECT
         qr.chapter_id,
         COUNT(*) as total_questions,
         SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) as correct_count,
         MAX(qr.answered_at) as last_attempt
       FROM question_responses qr
       WHERE qr.user_email = $1 AND qr.course_id = $2 AND qr.session_type = 'chapter_quiz'
       GROUP BY qr.chapter_id
       ORDER BY qr.chapter_id`,
      [email, active_paper]
    );

    const passingThreshold = parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75', 10);
    const chapterQuizzes = chapterQuizResult.rows.map(row => {
      const score = Math.round((parseInt(row.correct_count) / parseInt(row.total_questions)) * 100);
      return {
        chapter_id: row.chapter_id,
        score,
        total: parseInt(row.total_questions),
        correct: parseInt(row.correct_count),
        last_attempt: row.last_attempt,
        passed: score >= passingThreshold,
      };
    });

    // 5. Practice exam history — last attempt
    const lastExamResult = await pool.query(
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
      [email, active_paper]
    );

    // 6. Total chapters for this paper
    const totalChaptersResult = await pool.query(
      `SELECT COUNT(DISTINCT chapter_num) FROM chapters WHERE course_id = $1`,
      [active_paper]
    );
    const totalChapters = parseInt(totalChaptersResult.rows[0].count);

    const quizzesPassed = chapterQuizzes.filter(q => q.passed).length;
    const avgQuizScore = chapterQuizzes.length > 0
      ? Math.round(chapterQuizzes.reduce((sum, q) => sum + q.score, 0) / chapterQuizzes.length)
      : null;

    // Calculate last exam total score
    let lastExam = null;
    if (lastExamResult.rows.length > 0) {
      const totalCorrect = lastExamResult.rows.reduce((sum, r) => sum + parseInt(r.correct), 0);
      const totalQs = lastExamResult.rows.reduce((sum, r) => sum + parseInt(r.total), 0);
      lastExam = {
        score: Math.round((totalCorrect / totalQs) * 100),
        date: lastExamResult.rows[0].exam_date,
        chapters: lastExamResult.rows.map(r => ({
          chapter_id: r.chapter_id,
          score: Math.round((parseInt(r.correct) / parseInt(r.total)) * 100),
        })),
      };
    }

    // Next quiz ready = first chapter in sequence not yet passed
    const nextQuizChapterId = (() => {
      for (let i = 1; i <= totalChapters; i++) {
        const chapterId = `${active_paper}-${i}`;
        const quiz = chapterQuizzes.find(q => q.chapter_id === chapterId);
        if (!quiz || !quiz.passed) return chapterId;
      }
      return null;
    })();

    return res.json({
      paper: active_paper,
      progress: {
        completed_objectives: completedObjectives,
        total_objectives: totalObjectives,
        percent: totalObjectives > 0 ? Math.round((completedObjectives / totalObjectives) * 100) : 0,
        last_visited: lastVisited,
      },
      stats: {
        objectives_done: completedObjectives,
        quizzes_passed: quizzesPassed,
        avg_quiz_score: avgQuizScore,
        total_chapters: totalChapters,
      },
      chapter_quizzes: chapterQuizzes,
      next_quiz_chapter_id: nextQuizChapterId,
      last_exam: lastExam,
    });
  } catch (err) {
    console.error('GET /api/platform/lobby-data error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/course-structure/:paperCode
router.get('/course-structure/:paperCode', requireAuth, async (req, res) => {
  try {
    const { email } = req.user;
    const { paperCode } = req.params;
    const PASSING_THRESHOLD = parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75');

    // Get course outline (chapters + objectives)
    const outline = await getCourseOutline(paperCode);

    // Get completed objectives for this user
    const progressResult = await pool.query(
      `SELECT lesson_code FROM user_progress WHERE user_email = $1 AND lesson_code LIKE $2 AND completed = true`,
      [email, `${paperCode}-%`]
    );
    const completedLessons = new Set(progressResult.rows.map(r => r.lesson_code));

    // Get chapter quiz scores
    const quizResult = await pool.query(
      `SELECT chapter_id,
         COUNT(*) as total,
         SUM(CASE WHEN correct THEN 1 ELSE 0 END) as correct
       FROM question_responses
       WHERE user_email = $1 AND course_id = $2 AND session_type = 'chapter_quiz'
       GROUP BY chapter_id`,
      [email, paperCode]
    );
    const quizMap = {};
    for (const row of quizResult.rows) {
      const score = Math.round((parseInt(row.correct) / parseInt(row.total)) * 100);
      quizMap[row.chapter_id] = { score, passed: score >= PASSING_THRESHOLD };
    }

    // Build gated structure
    let previousChapterPassed = true; // chapter 1 is always unlocked
    const chapters = outline.chapters.map((chapter, idx) => {
      const chapterId = `${paperCode}-${chapter.chapter_num}`;
      const quiz = quizMap[chapterId];
      const quizPassed = quiz?.passed || false;
      const chapterLocked = !previousChapterPassed;

      const objectives = chapter.objectives.map((obj, objIdx) => {
        const previousComplete = objIdx === 0
          ? !chapterLocked
          : completedLessons.has(chapter.objectives[objIdx - 1].lesson_code);
        const objLocked = chapterLocked || (objIdx > 0 && !previousComplete);
        return {
          ...obj,
          completed: completedLessons.has(obj.lesson_code),
          locked: objLocked,
        };
      });

      const result = {
        ...chapter,
        chapter_id: chapterId,
        locked: chapterLocked,
        quiz_score: quiz?.score || null,
        quiz_passed: quizPassed,
        objectives,
      };

      previousChapterPassed = quizPassed;
      return result;
    });

    return res.json({ paper: paperCode, chapters });
  } catch (err) {
    console.error('GET /api/platform/course-structure error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/lesson-preview/:lessonCode
// No auth required — used for exam debrief lesson preview
router.get('/lesson-preview/:lessonCode', async (req, res) => {
  try {
    const { lessonCode } = req.params;
    const result = await pool.query(
      `SELECT lesson_code, title, narration_text, summary, key_points
       FROM lessons WHERE lesson_code = $1`,
      [lessonCode]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/platform/lesson-preview error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/check-access
// Query params: type ('lesson'|'chapter_quiz'), lesson_code or chapter_id
// Returns: { allowed: boolean, reason: string|null, required_lesson_code?: string, required_chapter_id?: string }
router.get('/check-access', requireAuth, async (req, res) => {
  const { type, lesson_code, chapter_id } = req.query;
  const { email } = req.user;

  const { isChapterQuizPassed, areAllObjectivesComplete } = require('../middleware/platformGate');

  try {
    if (type === 'lesson' && lesson_code) {
      const parts = lesson_code.split('-');
      if (parts.length < 3) return res.json({ allowed: true });

      const courseId = parts[0];
      const chapterNum = parseInt(parts[1], 10);
      const objectiveNum = parseInt(parts[2], 10);

      // Objective 1 of Chapter 1: always unlocked
      if (chapterNum === 1 && objectiveNum === 1) return res.json({ allowed: true });

      // Objective 1 of Chapter N (N>1): require previous chapter quiz passed
      if (objectiveNum === 1 && chapterNum > 1) {
        const prevChapterId = `${courseId}-${chapterNum - 1}`;
        const passed = await isChapterQuizPassed(email, prevChapterId);
        if (!passed) {
          return res.json({ allowed: false, reason: 'chapter_quiz', required_chapter_id: prevChapterId });
        }
        return res.json({ allowed: true });
      }

      // Objective N (N>1): require objective N-1 completed
      const prevLessonCode = `${courseId}-${chapterNum}-${objectiveNum - 1}`;
      const result = await pool.query(
        `SELECT completed FROM user_progress WHERE user_email = $1 AND lesson_code = $2`,
        [email, prevLessonCode]
      );
      const allowed = result.rows.length > 0 && result.rows[0].completed === true;
      return res.json({
        allowed,
        reason: allowed ? null : 'previous_objective',
        required_lesson_code: allowed ? undefined : prevLessonCode,
      });
    }

    if (type === 'chapter_quiz' && chapter_id) {
      const parts = chapter_id.split('-');
      if (parts.length < 2) return res.json({ allowed: true });
      const courseId = parts[0];
      const chapterNum = parseInt(parts[1], 10);
      const allDone = await areAllObjectivesComplete(email, courseId, chapterNum);
      return res.json({
        allowed: allDone,
        reason: allDone ? null : 'objectives_incomplete',
      });
    }

    // Unknown type or missing params — allow through
    return res.json({ allowed: true });
  } catch (err) {
    console.error('GET /api/platform/check-access error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/platform/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const u = req.user;
    return res.json({
      id: u.id,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      active_paper: u.active_paper,
      class_code: u.class_code,
      status: u.status,
      last_paper_switch_at: u.last_paper_switch_at,
    });
  } catch (err) {
    console.error('GET /api/platform/me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
