const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'fsa_agent',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

async function getLesson(lessonId) {
  // lessonId can be a lesson_code string (e.g. '2A1-1-1') or a numeric id
  const isNumeric = /^\d+$/.test(String(lessonId));
  const query = isNumeric
    ? 'SELECT id, lesson_code, title, video_transcript, summary, narration_text, key_points, practice_questions FROM lessons WHERE id = $1'
    : 'SELECT id, lesson_code, title, video_transcript, summary, narration_text, key_points, practice_questions FROM lessons WHERE lesson_code = $1';
  const result = await pool.query(query, [lessonId]);
  return result.rows[0] || null;
}

async function getLessonChunks(lessonId) {
  const isNumeric = /^\d+$/.test(String(lessonId));
  let lessonCode = lessonId;

  if (isNumeric) {
    const result = await pool.query('SELECT lesson_code FROM lessons WHERE id = $1', [lessonId]);
    lessonCode = result.rows[0]?.lesson_code || lessonId;
  }

  const result = await pool.query(
    `SELECT slide_number, title, narration
     FROM lesson_chunks
     WHERE lesson_code = $1
     ORDER BY slide_number ASC`,
    [lessonCode]
  );
  return result.rows;
}

async function getLessonByCode(lessonCode) {
  const result = await pool.query(
    'SELECT id, lesson_code, title, video_transcript, summary, narration_text, key_points, practice_questions FROM lessons WHERE lesson_code = $1',
    [lessonCode]
  );
  return result.rows[0] || null;
}

async function getUserProgress(userEmail, lessonId) {
  const result = await pool.query(
    'SELECT * FROM user_progress WHERE user_email = $1 AND lesson_id = $2',
    [userEmail, lessonId]
  );
  return result.rows[0] || null;
}

async function updateUserProgress({ user, lessonId, score, struggles, attempts, complexityLevel, completed, outcome, sessionNotes }) {
  // Normalize JSONB fields — ensure they are proper JSON strings for pg
  const safeStruggles = struggles == null ? null
    : typeof struggles === 'string' ? struggles
    : JSON.stringify(struggles);

  const safeAttempts = attempts == null ? null
    : typeof attempts === 'string' ? attempts
    : JSON.stringify(attempts);

  const safeComplexity = complexityLevel == null ? null : parseInt(complexityLevel, 10) || null;

  const result = await pool.query(
    `INSERT INTO user_progress
       (user_email, lesson_id, score, struggles, attempts, complexity_level, completed,
        outcome, session_notes, last_accessed)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, NOW())
     ON CONFLICT (user_email, lesson_id) DO UPDATE SET
       score            = COALESCE($3, user_progress.score),
       struggles        = COALESCE($4::jsonb, user_progress.struggles),
       attempts         = COALESCE($5::jsonb, user_progress.attempts),
       complexity_level = COALESCE($6, user_progress.complexity_level),
       completed        = COALESCE($7, user_progress.completed),
       outcome          = COALESCE($8, user_progress.outcome),
       session_notes    = COALESCE($9, user_progress.session_notes),
       last_accessed    = NOW()
     RETURNING *`,
    [
      user,
      lessonId,
      score ?? null,
      safeStruggles ?? '[]',
      safeAttempts ?? '{}',
      safeComplexity ?? 3,
      completed ?? null,
      outcome ?? null,
      sessionNotes ?? null,
    ]
  );
  return result.rows[0];
}

/**
 * Insert or update a user record.
 * Returns { user: { email, first_name, last_name }, created: bool }
 */
async function upsertUser({ email, first_name, last_name }) {
  const result = await pool.query(
    `INSERT INTO users (email, first_name, last_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name  = COALESCE(EXCLUDED.last_name, users.last_name),
       updated_at = NOW()
     RETURNING email, first_name, last_name,
               (xmax = 0) AS created`,
    [email, first_name, last_name || null]
  );
  const row = result.rows[0];
  return {
    user: { email: row.email, first_name: row.first_name, last_name: row.last_name },
    created: row.created,
  };
}

async function saveChatHistory(userEmail, lessonId, messages) {
  const safeMessages = typeof messages === 'string' ? messages : JSON.stringify(messages);

  const result = await pool.query(
    `INSERT INTO chat_history (user_email, lesson_id, messages)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_email, lesson_id) DO UPDATE SET
       messages = EXCLUDED.messages
     RETURNING id`,
    [userEmail, lessonId, safeMessages]
  );
  return result.rows[0];
}

/**
 * Fetch chapter-level accuracy weights for a user in a course.
 * Returns array of { chapter_id, accuracy, total }
 */
async function getChapterWeights(userEmail, courseId) {
  const result = await pool.query(
    `SELECT chapter_id,
            AVG(correct::int)::float AS accuracy,
            COUNT(*)::int            AS total
     FROM question_responses
     WHERE user_email = $1
       AND course_id  = $2
       AND chapter_id IS NOT NULL
     GROUP BY chapter_id`,
    [userEmail, courseId]
  );
  return result.rows;
}

// ── v2: Lesson Player ────────────────────────────────────────────────────────

async function getV2Lesson(lessonCode) {
  const chunksResult = await pool.query(
    `SELECT
       lc.slide_number,
       lc.chunk_type,
       lc.title,
       lc.body,
       lc.narration,
       lc.source_content,
       lc.audio_url,
       lc.image_url,
       lc.narration_timing,
       lc.checkpoint_after
     FROM lesson_chunks lc
     WHERE lc.lesson_code = $1
     ORDER BY lc.slide_number ASC`,
    [lessonCode]
  );
  if (chunksResult.rows.length === 0) return null;

  const metaResult = await pool.query(
    'SELECT title, summary FROM lessons WHERE lesson_code = $1',
    [lessonCode]
  );

  return {
    lesson_code: lessonCode,
    title: metaResult.rows[0]?.title || lessonCode,
    summary: metaResult.rows[0]?.summary || null,
    sections: chunksResult.rows,
  };
}

async function upsertLearnerSession(learnerId, lessonCode) {
  const result = await pool.query(
    `INSERT INTO learner_sessions (learner_id, lesson_code)
     VALUES ($1, $2)
     ON CONFLICT (learner_id, lesson_code) DO UPDATE
       SET updated_at = now()
     RETURNING *`,
    [learnerId, lessonCode]
  );
  return result.rows[0];
}

async function updateLearnerSession(sessionId, { lastSection, sectionsViewed, checkpointEntry }) {
  const updates = [];
  const values = [];
  let idx = 1;

  if (lastSection !== undefined) {
    updates.push(`last_section = $${idx++}`);
    values.push(lastSection);
  }
  if (sectionsViewed !== undefined) {
    updates.push(`sections_viewed = $${idx++}`);
    values.push(sectionsViewed);
  }
  if (checkpointEntry !== undefined) {
    updates.push(`checkpoint_log = checkpoint_log || $${idx++}::jsonb`);
    values.push(JSON.stringify([checkpointEntry]));
  }

  updates.push('updated_at = now()');
  values.push(sessionId);

  const result = await pool.query(
    `UPDATE learner_sessions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function getLearnerSession(sessionId) {
  const result = await pool.query(
    'SELECT * FROM learner_sessions WHERE id = $1',
    [sessionId]
  );
  return result.rows[0] || null;
}

// Every standalone practice question for a lesson. The caller picks one:
// first unasked, and once the pool is used up it recycles the least-recently
// asked rather than returning nothing. Objectives carry only ~5 of these, so
// the old exclude-and-LIMIT-1 query went permanently empty on a second pass
// through a lesson.
async function getCheckpointQuestionPool(lessonCode) {
  const result = await pool.query(
    `SELECT id, question_text, options, correct_answer, difficulty, question_type
     FROM questions
     WHERE lesson_code = $1
       AND question_type = 'objective_practice'
       AND standalone = true
     ORDER BY id`,
    [lessonCode]
  );
  return result.rows;
}

async function getCourseOutline(courseId) {
  const lessonsResult = await pool.query(
    `SELECT lesson_code, title FROM lessons
     WHERE lesson_code ~ $1
     ORDER BY lesson_code`,
    [`^${courseId}-\\d+-\\d+$`]
  );

  const chaptersResult = await pool.query(
    `SELECT chapter_num, title FROM chapters WHERE course_id = $1`,
    [courseId]
  );

  const chapterTitles = {};
  for (const row of chaptersResult.rows) {
    chapterTitles[row.chapter_num] = row.title;
  }

  const chaptersMap = {};
  for (const row of lessonsResult.rows) {
    const parts = row.lesson_code.split('-');
    const chapterNum = parseInt(parts[1], 10);
    const objectiveNum = parseInt(parts[2], 10);
    if (!chaptersMap[chapterNum]) {
      chaptersMap[chapterNum] = {
        chapter_num: chapterNum,
        label: chapterTitles[chapterNum] || `Chapter ${chapterNum}`,
        objectives: [],
      };
    }
    chaptersMap[chapterNum].objectives.push({
      lesson_code: row.lesson_code,
      title: row.title,
      objective_num: objectiveNum,
    });
  }

  const chapters = Object.values(chaptersMap).sort((a, b) => a.chapter_num - b.chapter_num);
  return { course_id: courseId, chapters };
}

async function getCourseProgress(learnerId, courseId) {
  const result = await pool.query(
    `SELECT learner_id, course_id, last_lesson_code, last_slide
     FROM course_progress
     WHERE learner_id = $1 AND course_id = $2`,
    [learnerId, courseId]
  );
  return result.rows[0] || null;
}

async function upsertCourseProgress(learnerId, courseId, lastLessonCode, lastSlide) {
  const result = await pool.query(
    `INSERT INTO course_progress (learner_id, course_id, last_lesson_code, last_slide, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (learner_id, course_id) DO UPDATE
       SET last_lesson_code = EXCLUDED.last_lesson_code,
           last_slide       = EXCLUDED.last_slide,
           updated_at       = now()
     RETURNING *`,
    [learnerId, courseId, lastLessonCode, lastSlide]
  );
  return result.rows[0];
}

module.exports = {
  pool,
  getLesson,
  getLessonByCode,
  getLessonChunks,
  getUserProgress,
  updateUserProgress,
  upsertUser,
  saveChatHistory,
  getChapterWeights,
  // v2
  getV2Lesson,
  upsertLearnerSession,
  updateLearnerSession,
  getLearnerSession,
  getCheckpointQuestionPool,
  getCourseOutline,
  getCourseProgress,
  upsertCourseProgress,
};