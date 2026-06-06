/**
 * platformGate.js — Gated progression middleware for the self-hosted platform.
 *
 * Rules:
 *  - Only applies when req.isPlatformMode === true (learn.* host)
 *  - Objective gate: objective N requires objective N-1 completed
 *  - Objective 1 of Chapter 1: always unlocked
 *  - Objective 1 of Chapter N (N>1): requires Chapter N-1 quiz passed
 *  - Chapter quiz gate: requires ALL objectives in that chapter completed
 *  - Practice exams: always accessible, never gated
 */

const { pool } = require('../services/database');

const PASSING_THRESHOLD = () => parseInt(process.env.QUIZ_PASSING_THRESHOLD || '75', 10);

/**
 * Check if a chapter quiz has been passed for a given user + chapterId.
 * chapterId format: '{COURSE}-{CHAPTER_NUM}' e.g. '3A1-1'
 */
async function isChapterQuizPassed(userEmail, chapterId) {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN correct THEN 1 ELSE 0 END) as correct
     FROM question_responses
     WHERE user_email = $1 AND chapter_id = $2 AND session_type = 'chapter_quiz'`,
    [userEmail, chapterId]
  );
  const row = result.rows[0];
  if (!row || parseInt(row.total, 10) === 0) return false;
  const score = Math.round((parseInt(row.correct, 10) / parseInt(row.total, 10)) * 100);
  return score >= PASSING_THRESHOLD();
}

/**
 * Check if all objectives in a chapter are completed for a given user.
 * courseId: e.g. '3A1', chapterNum: integer
 */
async function areAllObjectivesComplete(userEmail, courseId, chapterNum) {
  // Get all lesson codes for this chapter
  const lessonResult = await pool.query(
    `SELECT lesson_code FROM lessons WHERE lesson_code ~ $1 ORDER BY lesson_code`,
    [`^${courseId}-${chapterNum}-\\d+$`]
  );
  if (!lessonResult.rows.length) return false;

  const lessonCodes = lessonResult.rows.map(r => r.lesson_code);

  const progressResult = await pool.query(
    `SELECT COUNT(*) FROM user_progress
     WHERE user_email = $1 AND lesson_code = ANY($2) AND completed = true`,
    [userEmail, lessonCodes]
  );

  return parseInt(progressResult.rows[0].count, 10) >= lessonCodes.length;
}

/**
 * Middleware: gate lesson access.
 * Reads the lesson code from req.params.lessonCode (set by /:lessonCode route param).
 * Falls back to req.query.lesson or req.body.lessonId.
 */
async function gateLessonAccess(req, res, next) {
  // Only gate on platform mode with an authenticated user
  if (!req.isPlatformMode || !req.user) return next();

  const lessonCode = req.params.lessonCode || req.query.lesson || req.body?.lessonId;
  if (!lessonCode) return next();

  // Parse lesson code: COURSE-CHAPTER-OBJECTIVE
  const parts = lessonCode.split('-');
  if (parts.length < 3) return next(); // non-standard format — don't gate

  const courseId = parts[0];
  const chapterNum = parseInt(parts[1], 10);
  const objectiveNum = parseInt(parts[2], 10);
  const userEmail = req.user.email;

  try {
    // Objective 1 of Chapter 1: always unlocked
    if (chapterNum === 1 && objectiveNum === 1) return next();

    // Objective 1 of Chapter N (N>1): require previous chapter quiz passed
    if (objectiveNum === 1 && chapterNum > 1) {
      const prevChapterId = `${courseId}-${chapterNum - 1}`;
      const passed = await isChapterQuizPassed(userEmail, prevChapterId);
      if (!passed) {
        return res.status(403).json({
          error: 'locked',
          message: `Complete and pass the Chapter ${chapterNum - 1} quiz to unlock this chapter.`,
          locked_by: 'chapter_quiz',
          required_chapter_id: prevChapterId,
        });
      }
      return next();
    }

    // Objective N (N>1) in any chapter: require objective N-1 completed
    const prevLessonCode = `${courseId}-${chapterNum}-${objectiveNum - 1}`;
    const prevResult = await pool.query(
      `SELECT completed FROM user_progress WHERE user_email = $1 AND lesson_code = $2`,
      [userEmail, prevLessonCode]
    );

    if (!prevResult.rows.length || !prevResult.rows[0].completed) {
      return res.status(403).json({
        error: 'locked',
        message: `Complete objective ${objectiveNum - 1} first.`,
        locked_by: 'previous_objective',
        required_lesson_code: prevLessonCode,
      });
    }

    next();
  } catch (err) {
    console.error('platformGate lesson error:', err);
    next(); // fail open — don't block users on gate errors
  }
}

/**
 * Middleware: gate chapter quiz access.
 * Expects req.params.chapterId or req.query.chapter_id (format: '{COURSE}-{CHAPTER_NUM}').
 */
async function gateChapterQuizAccess(req, res, next) {
  if (!req.isPlatformMode || !req.user) return next();

  const chapterId = req.params.chapterId || req.query.chapter_id;
  if (!chapterId || !chapterId.includes('-')) return next();

  const parts = chapterId.split('-');
  const courseId = parts[0]; // e.g. '3A1'
  const chapterNum = parseInt(parts[1], 10); // e.g. 1
  const userEmail = req.user.email;

  try {
    const allDone = await areAllObjectivesComplete(userEmail, courseId, chapterNum);
    if (!allDone) {
      return res.status(403).json({
        error: 'locked',
        message: `Complete all objectives in Chapter ${chapterNum} to unlock the quiz.`,
        locked_by: 'objectives_incomplete',
      });
    }
    next();
  } catch (err) {
    console.error('platformGate quiz error:', err);
    next(); // fail open
  }
}

module.exports = { gateLessonAccess, gateChapterQuizAccess, isChapterQuizPassed, areAllObjectivesComplete };
