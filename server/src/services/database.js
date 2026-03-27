const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'fsa_agent',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

async function getLesson(lessonId) {
  const result = await pool.query(
    'SELECT id, title, video_transcript, summary, key_points, practice_questions FROM lessons WHERE id = $1',
    [lessonId]
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

async function updateUserProgress({ user, lessonId, score, struggles, attempts, complexityLevel, completed }) {
  const existing = await getUserProgress(user, lessonId);

  if (existing) {
    const result = await pool.query(
      `UPDATE user_progress
       SET score = COALESCE($1, score),
           struggles = COALESCE($2, struggles),
           attempts = COALESCE($3, attempts),
           complexity_level = COALESCE($4, complexity_level),
           completed = COALESCE($5, completed),
           last_accessed = NOW()
       WHERE user_email = $6 AND lesson_id = $7
       RETURNING *`,
      [score, struggles, attempts, complexityLevel, completed, user, lessonId]
    );
    return result.rows[0];
  } else {
    const result = await pool.query(
      `INSERT INTO user_progress (user_email, lesson_id, score, struggles, attempts, complexity_level, completed, last_accessed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [user, lessonId, score || 0, struggles || '[]', attempts || '{}', complexityLevel || 3, completed || false]
    );
    return result.rows[0];
  }
}

module.exports = {
  pool,
  getLesson,
  getUserProgress,
  updateUserProgress,
};