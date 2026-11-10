-- Mini lessons: free public lessons at /explained/<slug>. Idempotent.
-- Identity, status, tokens and version pointers live on mini_lessons; per-build
-- metadata (title, description, ...) is versioned in mini_lesson_versions so a
-- rebuild never changes what a live lesson serves.
BEGIN;
CREATE TABLE IF NOT EXISTS mini_lessons (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(80) UNIQUE NOT NULL,
  paper_code VARCHAR(10) NOT NULL,
  source_lesson_code VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','awaiting_approval','live','held')),
  preview_token VARCHAR(64) NOT NULL,
  checks_passed BOOLEAN NOT NULL DEFAULT false,
  hold_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  live_version INT,
  draft_version INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mini_lesson_versions (
  mini_lesson_id INT NOT NULL REFERENCES mini_lessons(id) ON DELETE CASCADE,
  version INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_label TEXT NOT NULL,
  og_image_url TEXT,
  request_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mini_lesson_id, version)
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
