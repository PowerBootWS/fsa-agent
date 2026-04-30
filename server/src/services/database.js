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
};