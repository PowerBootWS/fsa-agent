-- FSA Agent Schema Migration v2
-- Run once against the live database to fix column types and add the questions table.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards where possible).

-- ============================================================
-- Step 1: Fix user_progress column types
-- PostgreSQL requires explicit USING clause for TEXT/INT -> JSONB casts
-- ============================================================

ALTER TABLE user_progress
  ALTER COLUMN struggles TYPE JSONB USING
    CASE
      WHEN struggles IS NULL OR struggles = '' THEN '[]'::jsonb
      ELSE to_jsonb(string_to_array(struggles, ','))
    END;

ALTER TABLE user_progress
  ALTER COLUMN attempts TYPE JSONB USING
    CASE
      WHEN attempts IS NULL THEN '{}'::jsonb
      WHEN attempts = 0    THEN '{}'::jsonb
      ELSE jsonb_build_object('legacy_count', attempts)
    END;

ALTER TABLE user_progress
  ALTER COLUMN complexity_level TYPE INTEGER USING
    CASE complexity_level
      WHEN 'easy'   THEN 1
      WHEN 'medium' THEN 3
      WHEN 'hard'   THEN 5
      ELSE 3
    END;

-- Step 2: Add new columns to user_progress
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20),
  ADD COLUMN IF NOT EXISTS session_notes TEXT;

-- Add outcome constraint (only if not already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_outcome'
  ) THEN
    ALTER TABLE user_progress
      ADD CONSTRAINT chk_outcome
        CHECK (outcome IN ('completed', 'skipped', 'struggled', 'strong') OR outcome IS NULL);
  END IF;
END $$;

-- ============================================================
-- Step 3: Create dedicated questions table
-- ============================================================

CREATE TABLE IF NOT EXISTS questions (
  id             SERIAL PRIMARY KEY,
  lesson_id      INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  chapter_id     VARCHAR(50),
  course_id      VARCHAR(50),
  question_text  TEXT NOT NULL,
  options        JSONB NOT NULL,
  correct_answer INTEGER NOT NULL,
  explanation    TEXT,
  difficulty     INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  topic          VARCHAR(100),
  question_type  VARCHAR(30) NOT NULL DEFAULT 'objective_practice'
                   CHECK (question_type IN ('objective_practice', 'chapter_quiz')),
  step_data      JSONB,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_lesson     ON questions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_questions_chapter    ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_questions_type       ON questions(question_type);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);

-- ============================================================
-- Step 4: Seed questions from lessons.practice_questions JSONB
-- (one-time migration for lesson_id = 1)
-- ============================================================

INSERT INTO questions (
  lesson_id, chapter_id, course_id, question_text, options,
  correct_answer, difficulty, topic, question_type
)
SELECT
  1 AS lesson_id,
  '1' AS chapter_id,
  '2A1' AS course_id,
  elem->>'question'         AS question_text,
  elem->'options'           AS options,
  (elem->>'correct_answer')::int AS correct_answer,
  COALESCE((elem->>'difficulty')::int, 2) AS difficulty,
  elem->>'topic'            AS topic,
  'objective_practice'      AS question_type
FROM lessons,
     jsonb_array_elements(practice_questions) AS elem
WHERE id = 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- Verification queries (uncomment to check after migration)
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'user_progress'
--   ORDER BY ordinal_position;
-- SELECT COUNT(*) AS questions_seeded FROM questions;
-- SELECT id, question_text, difficulty, question_type FROM questions LIMIT 5;
