-- Mini lessons: free public lessons at /explained/<slug>. Idempotent.
BEGIN;
CREATE TABLE IF NOT EXISTS mini_lessons (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(80) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  paper_code VARCHAR(10) NOT NULL,
  source_lesson_code VARCHAR(20),
  source_label TEXT NOT NULL,
  request_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','awaiting_approval','live','held')),
  preview_token VARCHAR(64) NOT NULL,
  checks_passed BOOLEAN NOT NULL DEFAULT false,
  hold_reason TEXT,
  og_image_url TEXT,
  version INT NOT NULL DEFAULT 1,
  live_version INT,
  draft_version INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mini_lesson_slides (
  id SERIAL PRIMARY KEY,
  mini_lesson_id INT NOT NULL REFERENCES mini_lessons(id) ON DELETE CASCADE,
  version INT NOT NULL,
  slide_number INT NOT NULL,
  chunk_type TEXT,
  title TEXT,
  body TEXT,
  narration TEXT,
  audio_url TEXT,
  image_url TEXT,
  narration_timing JSONB,
  UNIQUE (mini_lesson_id, version, slide_number)
);

CREATE TABLE IF NOT EXISTS mini_lesson_questions (
  id SERIAL PRIMARY KEY,
  mini_lesson_id INT NOT NULL REFERENCES mini_lessons(id) ON DELETE CASCADE,
  version INT NOT NULL,
  position INT NOT NULL,
  question_text TEXT NOT NULL,
  step_data JSONB NOT NULL,
  explanation TEXT
);
CREATE INDEX IF NOT EXISTS idx_mini_lesson_questions_ver ON mini_lesson_questions (mini_lesson_id, version, position);
COMMIT;
